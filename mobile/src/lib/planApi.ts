import { useEffect, useMemo, useState } from 'react';
import { apiCachedGet, isPendingId, type Id } from './api';
import { distanceMeters } from './plan';

/**
 * Plan iyileştirmeleri (PLN, AC-MOB-43/44): yaya rotası ve açılış saatleri istemcisi.
 * İkisi de önbellekli GET kullanır (`apiCachedGet`): son başarılı yanıt cihazda adresine göre saklanır, çevrimdışıyken
 * oradan döner. Rota adresi noktaları içerdiği için önbellek anahtarı = günün durak imzası. Ayrıca oturum boyunca
 * bellekte tutulur (aynı gün tekrar çizilince istek atılmaz).
 */

export interface WalkLeg { distanceM: number; durationS: number }
export interface WalkRoute { legs: WalkLeg[]; totalDistanceM: number; totalDurationS: number; provider: string }
export interface PlaceHours { openingHours: string | null; source: string; fetchedAt: string }

type LatLon = { lat: number; lon: number };

/** Günün durak imzası: yuvarlanmış koordinatlar (≈1 m), sırayla. */
export const routeSignature = (points: LatLon[]): string =>
  points.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';');

const routeMemo = new Map<string, Promise<WalkRoute>>();
const hoursMemo = new Map<string, Promise<PlaceHours>>();

export function fetchWalkRoute(points: LatLon[]): Promise<WalkRoute> {
  const sig = routeSignature(points);
  let p = routeMemo.get(sig);
  if (!p) {
    p = apiCachedGet<WalkRoute>(`/routes/walk?points=${encodeURIComponent(sig)}`);
    routeMemo.set(sig, p);
    p.catch(() => routeMemo.delete(sig));
  }
  return p;
}

export function fetchPlaceHours(placeId: Id): Promise<PlaceHours> {
  const key = String(placeId);
  let p = hoursMemo.get(key);
  if (!p) {
    p = apiCachedGet<PlaceHours>(`/places/${key}/hours`);
    hoursMemo.set(key, p);
    p.catch(() => hoursMemo.delete(key));
  }
  return p;
}

export type DayRouteState =
  | { kind: 'none' }
  | { kind: 'loading' }
  /** legs[i]: i. konumlu duraktan bir sonrakine. */
  | { kind: 'walk'; route: WalkRoute }
  | { kind: 'straight'; legs: number[]; totalM: number };

const straight = (pts: LatLon[]) => {
  const legs = pts.slice(1).map((p, i) => distanceMeters(pts[i], p));
  return { kind: 'straight' as const, legs, totalM: legs.reduce((s, d) => s + d, 0) };
};

/**
 * Günün yaya rotası (AC-MOB-43): konumlu duraklar sırasıyla `/routes/walk`'a gider. Rota alınamazsa (çevrimdışı ve
 * önbellekte yok, sağlayıcı hatası) kuş uçuşu mesafeye düşer.
 */
export function useDayRoute(points: LatLon[]): DayRouteState {
  const sig = useMemo(() => routeSignature(points), [points]);
  const [state, setState] = useState<{ sig: string; value: DayRouteState }>({ sig: '', value: { kind: 'none' } });
  useEffect(() => {
    const pts = sig ? sig.split(';').map((s) => { const [lat, lon] = s.split(',').map(Number); return { lat, lon }; }) : [];
    if (pts.length < 2) { setState({ sig, value: { kind: 'none' } }); return; }
    let alive = true;
    setState({ sig, value: { kind: 'loading' } });
    fetchWalkRoute(pts)
      .then((route) => {
        if (!alive) return;
        setState({ sig, value: route.legs.length === pts.length - 1 ? { kind: 'walk', route } : straight(pts) });
      })
      .catch(() => { if (alive) setState({ sig, value: straight(pts) }); });
    return () => { alive = false; };
  }, [sig]);
  return state.sig === sig ? state.value : { kind: 'loading' };
}

/** Bir yerin opening_hours metni; bilinmiyorsa, bekleyen (çevrimdışı oluşturulmuş) yerde ya da hatada null. */
export function usePlaceHours(placeId: Id | null | undefined): string | null {
  const [text, setText] = useState<{ id: string; value: string | null }>({ id: '', value: null });
  const id = placeId === null || placeId === undefined ? '' : String(placeId);
  useEffect(() => {
    if (!id || isPendingId(id)) return;
    let alive = true;
    fetchPlaceHours(id)
      .then((h) => { if (alive) setText({ id, value: h.openingHours ?? null }); })
      .catch(() => { if (alive) setText({ id, value: null }); });
    return () => { alive = false; };
  }, [id]);
  return text.id === id ? text.value : null;
}

/** "42 dk" / "1 sa 5 dk" (en az 1 dk). */
export function formatDuration(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}
