import type { PlaceCard } from './api';

/** Türkçe ondalık: 4.6 -> "4,6". */
const dec = (n: number) => n.toFixed(1).replace('.', ',');

/**
 * Kart özeti (AC-MOB-26): "4,6 · 12 puan · bu hafta 34 bakış". Puan yoksa "Henüz puan yok"; bakış yoksa o kısım
 * yazılmaz. `withAvg: false`: ortalama ayrıca gösteriliyorsa ("12 puan · bu hafta 34 bakış").
 */
export function cardStats(c: Pick<PlaceCard, 'avgStars' | 'ratingCount' | 'views7d'>, withAvg = true): string {
  const rated = c.avgStars !== null && c.ratingCount > 0;
  const parts = [rated ? (withAvg ? `${dec(c.avgStars as number)} · ${c.ratingCount} puan` : `${c.ratingCount} puan`) : 'Henüz puan yok'];
  if (c.views7d > 0) parts.push(`bu hafta ${c.views7d} bakış`);
  return parts.join(' · ');
}

export const DEFAULT_CITY = 'İstanbul';

/**
 * Keşfet'in varsayılan şehri: cihaz konumuna en yakın şehir (izin zaten verilmişse), yoksa kullanıcının en son
 * güncellenen listesinin şehri, o da yoksa İstanbul.
 */
export function pickDefaultCity(nearest: string | null | undefined, lastListCity: string | null | undefined): string {
  return nearest?.trim() || lastListCity?.trim() || DEFAULT_CITY;
}
