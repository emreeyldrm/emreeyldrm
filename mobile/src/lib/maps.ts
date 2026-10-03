import { Linking, Platform } from 'react-native';
import { normalizeGoogleMapsUrl } from './takeout';

export interface MapsTarget {
  name: string;
  lat: number | null;
  lon: number | null;
  /** Arama sonucunun adresi ya da listenin şehri: aynı adlı yerleri ayırt etmek için sorguya eklenir. */
  address?: string | null;
  city?: string | null;
  provider?: string | null;
  providerId?: string | null;
  /** Google'dan içe aktarılan yerin kendi bağlantısı (`details.googleMapsUrl`, AC-MOB-36): varsa birebir açılır. */
  googleMapsUrl?: string | null;
}

const hasCoords = (p: MapsTarget) =>
  p.lat !== null && p.lon !== null && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/** Google Maps'te aranacak metin: "Ad, adres" ya da "Ad, şehir" (ad zaten içeriyorsa tekrar etmez). */
export function mapsQuery(p: MapsTarget): string {
  const name = p.name.trim();
  const extra = (p.address || p.city || '').trim();
  if (!extra || name.toLocaleLowerCase('tr').includes(extra.toLocaleLowerCase('tr'))) return name;
  return `${name}, ${extra}`;
}

/**
 * AC-MOB-13: Google Maps yer adıyla açılır (koordinatla değil), böylece Maps kendi işaretini ve bilgilerini gösterir.
 * Google kaynaklı yerlerde `query_place_id` ile birebir o yer açılır.
 */
export function googleMapsUrl(p: MapsTarget): string {
  const base = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery(p))}`;
  return p.provider === 'google' && p.providerId ? `${base}&query_place_id=${encodeURIComponent(p.providerId)}` : base;
}

/** iOS Google Maps uygulaması: adla arar, kayıtlı koordinat yakınlık ipucu olur. */
export function googleMapsAppUrl(p: MapsTarget): string {
  const center = hasCoords(p) ? `&center=${p.lat},${p.lon}` : '';
  return `comgooglemaps://?q=${encodeURIComponent(mapsQuery(p))}${center}`;
}

/** Directions through the day's stops in order (Google Maps URLs API). */
export function googleDirectionsUrl(stops: { lat: number; lon: number }[]): string | null {
  if (stops.length < 2) return null;
  const fmt = (s: { lat: number; lon: number }) => `${s.lat},${s.lon}`;
  const origin = fmt(stops[0]);
  const destination = fmt(stops[stops.length - 1]);
  const mid = stops.slice(1, -1).map(fmt).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${mid ? `&waypoints=${encodeURIComponent(mid)}` : ''}&travelmode=walking`;
}

export function openInGoogleMaps(p: MapsTarget): void {
  // AC-MOB-36: Google'daki kayıtlı yer (içe aktarılan bağlantı) en kesin olanıdır; https bağlantısı uygulama yüklüyse
  // uygulamada açılır. Yalnızca izinli Google Maps adresleri (sunucuyla aynı kural).
  const saved = normalizeGoogleMapsUrl(p.googleMapsUrl);
  if (saved) {
    void Linking.openURL(saved).catch(() => Linking.openURL(googleMapsUrl(p))).catch(() => undefined);
    return;
  }
  const web = googleMapsUrl(p);
  // Google kimliği varsa web bağlantısı (query_place_id) en kesin olanıdır; uygulama yüklüyse o da uygulamada açılır.
  if (Platform.OS === 'ios' && !(p.provider === 'google' && p.providerId)) {
    void Linking.openURL(googleMapsAppUrl(p)).catch(() => Linking.openURL(web)).catch(() => undefined);
    return;
  }
  void Linking.openURL(web).catch(() => undefined);
}

export function openUrl(url: string): void {
  void Linking.openURL(url).catch(() => undefined);
}
