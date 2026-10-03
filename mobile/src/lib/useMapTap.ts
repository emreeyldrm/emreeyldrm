import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SearchResult } from './api';
import { distanceMeters } from './plan';

export interface LatLon { lat: number; lon: number }

/**
 * Haritada dokunma (AC-MOB-28): `tap` = boş bir noktaya ya da işletme simgesine dokunma (konumla yakındaki yerler),
 * `poi` = haritanın kendi yer işareti (Android / Google: `onPoiClick` adı ve konumuyla o yer aranır).
 */
export type TapSource = 'tap' | 'poi';
export interface TapState {
  id: number;
  point: LatLon;
  source: TapSource;
  poiName?: string;
  status: 'loading' | 'done' | 'error';
  /** En yakın (ya da ada en uygun) yer önce. */
  results: SearchResult[];
  /** Kartta gösterilen sonuç ("Başka bir yer mi?" ile değişir). */
  index: number;
}

/** Arka arkaya dokunmalarda yalnızca sonuncusu aranır. */
export const TAP_DEBOUNCE_MS = 250;
/** POI adıyla bulunan sonuç dokunulan noktadan en çok bu kadar uzak olabilir. */
export const POI_MATCH_RADIUS_M = 250;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * `onPoiClick` adına en uygun arama sonucu: yakında (POI_MATCH_RADIUS_M) ve adı eşleşen (biri diğerini içeren) en yakın
 * sonuç; yoksa null (çağıran yakındaki yerlere düşer).
 */
export function pickPoiMatch(name: string, point: LatLon, results: SearchResult[]): SearchResult | null {
  const n = fold(name);
  if (!n) return null;
  const near = results
    .map((r) => ({ r, d: distanceMeters(point, r) }))
    .filter((x) => x.d <= POI_MATCH_RADIUS_M)
    .sort((a, b) => a.d - b.d);
  const hit = near.find(({ r }) => { const f = fold(r.name); return !!f && (f.includes(n) || n.includes(f)); });
  return hit?.r ?? null;
}

const key = (r: SearchResult) => `${r.provider}:${r.providerId}`;

async function lookup(point: LatLon, poiName?: string): Promise<SearchResult[]> {
  if (!poiName) return api.searchNearby(point);
  // POI: adla ara (dokunulan noktaya göre sıralı); en uygun sonuç önce, yakındaki diğerleri "Başka bir yer mi?" için.
  const [named, nearby] = await Promise.all([
    api.searchPlaces(poiName, point).catch(() => [] as SearchResult[]),
    api.searchNearby(point).catch(() => null),
  ]);
  const best = pickPoiMatch(poiName, point, named);
  if (!best) {
    if (nearby === null) throw new Error('Yakındaki yerler alınamadı');
    return nearby;
  }
  return [best, ...(nearby ?? []).filter((r) => key(r) !== key(best))];
}

/**
 * Dokunma durumu: anında geçici işaret (status: loading), TAP_DEBOUNCE_MS sonra arama; eski yanıtlar yok sayılır.
 * `isSaved`: kartta "Listeye ekle" ile eklenen yer listeye girince kart ve geçici işaret kapanır (AC-MOB-16 gibi).
 */
export function useMapTap(isSaved?: (r: SearchResult) => boolean) {
  const [tap, setTap] = useState<TapState | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  const tapAt = useCallback((point: LatLon, poiName?: string) => {
    const id = ++seq.current;
    stopTimer();
    setTap({ id, point, source: poiName ? 'poi' : 'tap', poiName, status: 'loading', results: [], index: 0 });
    timer.current = setTimeout(() => {
      timer.current = null;
      lookup(point, poiName)
        .then((results) => { if (seq.current === id) setTap((t) => (t && t.id === id ? { ...t, status: 'done', results } : t)); })
        .catch(() => { if (seq.current === id) setTap((t) => (t && t.id === id ? { ...t, status: 'error' } : t)); });
    }, TAP_DEBOUNCE_MS);
  }, []);

  const choose = useCallback((index: number) => setTap((t) => (t ? { ...t, index } : t)), []);
  const clear = useCallback(() => { seq.current++; stopTimer(); setTap(null); }, []);
  const latest = useRef<TapState | null>(null);
  latest.current = tap;
  const retry = useCallback(() => { const t = latest.current; if (t) tapAt(t.point, t.poiName); }, [tapAt]);

  useEffect(() => () => stopTimer(), []);

  const current = tap && tap.status === 'done' ? tap.results[tap.index] ?? null : null;

  const [adding, setAdding] = useState<string | null>(null);
  const addRequested = useCallback((r: SearchResult) => setAdding(key(r)), []);
  const addedNow = !!adding && !!current && key(current) === adding && !!isSaved?.(current);
  useEffect(() => {
    if (addedNow) { setAdding(null); clear(); }
  }, [addedNow, clear]);

  return { tap, current, tapAt, choose, clear, retry, addRequested };
}
