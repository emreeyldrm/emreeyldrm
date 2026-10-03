import type { Category, SearchResult } from '../lib/api';

export interface MapPlace {
  id: string; name: string; category: Category; lat: number; lon: number; note?: string | null;
  /** Google Maps'te adla açmak için (AC-MOB-13). */
  city?: string | null; provider?: string | null; providerId?: string | null;
}
export interface LatLon { lat: number; lon: number }
export interface RouteStop extends MapPlace { n: number }

/** Props shared by PlacesMap (native) and PlacesMap.web (fallback). */
export interface PlacesMapProps {
  places: MapPlace[];
  unlocated: number;
  onOpenPlace: (id: string) => void;
  /** Centre of the list's located places (search bias when the map has not been panned). */
  center: LatLon | null;
  /** Search result shown with a temporary pin and the bottom card (AC-MOB-15); null = none. */
  searchPick: SearchResult | null;
  onSearchPick: (r: SearchResult | null) => void;
  /** "Listeye ekle" on the card (only for the list owner). */
  onAddPick?: (r: SearchResult) => void;
  /** The picked result is already in the list. */
  pickSaved?: boolean;
}

export interface Region { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }

/** Region that fits all points (with padding); falls back to İstanbul. */
export function regionFor(points: LatLon[], fallback?: LatLon | null): Region {
  if (!points.length) {
    const c = fallback ?? { lat: 41.0082, lon: 28.9784 };
    return { latitude: c.lat, longitude: c.lon, latitudeDelta: 0.08, longitudeDelta: 0.08 };
  }
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(0.01, (maxLon - minLon) * 1.6),
  };
}

export const fmtCoord = (p: LatLon): string => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
