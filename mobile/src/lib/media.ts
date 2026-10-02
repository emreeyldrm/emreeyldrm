import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { API_URL, ApiError, currentToken } from './api';

/** Media URLs from the API are relative (`/media/<id>`); ids are turned into absolute image URLs. */
export function mediaSrc(idOrUrl: string): string {
  if (/^(https?:|blob:|data:|file:)/.test(idOrUrl)) return idOrUrl;
  const path = idOrUrl.startsWith('/') ? idOrUrl : `/media/${idOrUrl}`;
  return API_URL + path;
}

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.7;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export interface PreparedImage { uri: string; type: string }

/** Resizes to at most 1600 px on the long side and re-encodes as JPEG (~0.7); falls back to the original. */
export async function prepareImage(asset: { uri: string; width?: number; height?: number; mimeType?: string | null }): Promise<PreparedImage> {
  try {
    const ctx = ImageManipulator.manipulate(asset.uri);
    const w = asset.width ?? 0;
    const h = asset.height ?? 0;
    if (Math.max(w, h) > MAX_SIDE) ctx.resize(w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
    ctx.release?.();
    img.release?.();
    return { uri: out.uri, type: 'image/jpeg' };
  } catch {
    const type = (asset.mimeType ?? '').toLowerCase();
    if (ACCEPTED.includes(type)) return { uri: asset.uri, type };
    throw new ApiError(415, 'Bu fotoğraf işlenemedi. JPEG, PNG ya da WebP seç.');
  }
}

/** Turkish message for an upload failure. */
export function uploadError(e: unknown): string {
  const status = e instanceof ApiError ? e.status : -1;
  if (status === 413) return 'Fotoğraf çok büyük (en çok 5 MB).';
  if (status === 415) return e instanceof ApiError && e.message.startsWith('Bu fotoğraf') ? e.message : 'Bu dosya türü desteklenmiyor (JPEG, PNG, WebP).';
  if (status === 401) return 'Oturumun sona erdi; tekrar giriş yap.';
  if (status === 0) return 'Fotoğraf yüklenemedi: sunucuya ulaşılamadı.';
  return 'Fotoğraf yüklenemedi. Tekrar dene.';
}

/** POST /media with the raw image body (XHR for upload progress). Resolves to the media id. */
export async function uploadImage(img: PreparedImage, onProgress?: (fraction: number) => void): Promise<string> {
  let blob: Blob;
  try { blob = await (await fetch(img.uri)).blob(); } catch { throw new ApiError(415, 'Bu fotoğraf okunamadı.'); }
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/media`);
    xhr.setRequestHeader('Content-Type', img.type);
    const token = currentToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data: { id?: string; error?: string } | null = null;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      if (xhr.status === 201 && data?.id) { onProgress?.(1); resolve(data.id); }
      else reject(new ApiError(xhr.status, data?.error ?? `Hata (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Sunucuya ulaşılamadı'));
    xhr.ontimeout = () => reject(new ApiError(0, 'Sunucuya ulaşılamadı'));
    xhr.send(blob);
  });
}

export type PhotoSource = 'library' | 'camera';
/** Camera is offered on native only; on web the library picker is a file input. */
export const CAMERA_AVAILABLE = Platform.OS !== 'web';

/** Opens the photo library (multiple) or the camera; asks for permission first. */
export async function pickImages(source: PhotoSource, limit: number): Promise<ImagePicker.ImagePickerAsset[]> {
  if (limit <= 0) return [];
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Kamera izni verilmedi.');
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    return r.canceled ? [] : r.assets.slice(0, 1);
  }
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error('Fotoğraflara erişim izni verilmedi.');
  }
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: limit > 1, selectionLimit: limit, quality: 1,
  });
  return r.canceled ? [] : r.assets.slice(0, limit);
}

export type PhotoStatus = 'uploading' | 'done' | 'error';
export interface PhotoSlot {
  key: string;
  /** Preview: local file/blob while uploading, the API URL for already saved photos. */
  uri: string;
  id?: string;
  status: PhotoStatus;
  progress: number;
  error?: string;
}

let seq = 0;
const nextKey = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Photo list with per-photo upload state, shared by the add-place sheet (≤ 6) and the comment composer (≤ 4).
 * `ids` are the uploaded media ids in order; `busy` is true while any upload runs.
 */
export function usePhotoUploads(max: number) {
  const [slots, setSlots] = useState<PhotoSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const patch = useCallback((key: string, p: Partial<PhotoSlot>) => {
    if (alive.current) setSlots((all) => all.map((s) => (s.key === key ? { ...s, ...p } : s)));
  }, []);

  const reset = useCallback((ids: string[] = []) => {
    setError(null);
    setSlots(ids.slice(0, max).map((id) => ({ key: nextKey(), uri: mediaSrc(id), id, status: 'done', progress: 1 })));
  }, [max]);

  const upload = useCallback(async (key: string, asset: Parameters<typeof prepareImage>[0]) => {
    try {
      const img = await prepareImage(asset);
      const id = await uploadImage(img, (f) => patch(key, { progress: f }));
      patch(key, { id, status: 'done', progress: 1, error: undefined });
    } catch (e) {
      const msg = uploadError(e);
      patch(key, { status: 'error', error: msg });
      if (alive.current) setError(msg);
    }
  }, [patch]);

  const add = useCallback(async (source: PhotoSource) => {
    setError(null);
    const room = max - slots.length;
    if (room <= 0) { setError(`En çok ${max} fotoğraf eklenebilir.`); return; }
    let assets: ImagePicker.ImagePickerAsset[];
    try { assets = await pickImages(source, room); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    if (!assets.length || !alive.current) return;
    const fresh = assets.slice(0, room).map((a) => ({ asset: a, slot: { key: nextKey(), uri: a.uri, status: 'uploading' as const, progress: 0 } }));
    setSlots((all) => [...all, ...fresh.map((f) => f.slot)].slice(0, max));
    await Promise.all(fresh.map((f) => upload(f.slot.key, f.asset)));
  }, [max, slots.length, upload]);

  const remove = useCallback((key: string) => {
    setSlots((all) => {
      const next = all.filter((s) => s.key !== key);
      if (!next.some((s) => s.status === 'error')) setError(null);
      return next;
    });
  }, []);

  const busy = slots.some((s) => s.status === 'uploading');
  const ids = slots.filter((s) => s.status === 'done' && s.id).map((s) => s.id as string);
  return { slots, ids, busy, error, add, remove, reset, max };
}
export type PhotoUploads = ReturnType<typeof usePhotoUploads>;
