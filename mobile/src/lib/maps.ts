import { Linking } from 'react-native';

export interface MapsTarget { name: string; lat: number | null; lon: number | null }

/**
 * AC-MOB-13 — same rules as `Place.mapsLink` in Voyage/Models/Place.swift:
 * with coordinates `query=<lat>,<lon>`, otherwise `query=<url-encoded name>`.
 */
export function googleMapsUrl(p: MapsTarget): string {
  const base = 'https://www.google.com/maps/search/?api=1&query=';
  if (p.lat !== null && p.lon !== null && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
    return `${base}${p.lat},${p.lon}`;
  }
  return base + encodeURIComponent(p.name);
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
  void Linking.openURL(googleMapsUrl(p)).catch(() => undefined);
}

export function openUrl(url: string): void {
  void Linking.openURL(url).catch(() => undefined);
}
