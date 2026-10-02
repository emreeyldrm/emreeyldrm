import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Category, Id } from './api';

/** A place as the planner needs it. */
export interface PlanPlace { id: string; name: string; category: Category; lat: number | null; lon: number | null }

/** Plan stored on device per list (AC-MOB-12): number of days and ordered place ids per day. */
export interface Plan { dayCount: number; days: Record<string, string[]> }

export const MIN_DAYS = 1;
export const MAX_DAYS = 14;
export const emptyPlan = (): Plan => ({ dayCount: 3, days: {} });

const key = (listId: Id) => `voyage.plan.${String(listId)}`;

export async function loadPlan(listId: Id): Promise<Plan> {
  try {
    const raw = await AsyncStorage.getItem(key(listId));
    if (!raw) return emptyPlan();
    const p = JSON.parse(raw) as Partial<Plan>;
    const dayCount = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Number(p.dayCount) || 3));
    const days: Record<string, string[]> = {};
    for (const [d, ids] of Object.entries(p.days ?? {})) {
      if (Array.isArray(ids)) days[d] = ids.map(String);
    }
    return { dayCount, days };
  } catch {
    return emptyPlan();
  }
}

export async function savePlan(listId: Id, plan: Plan): Promise<void> {
  try {
    await AsyncStorage.setItem(key(listId), JSON.stringify(plan));
  } catch {
    /* storage unavailable: plan stays in memory */
  }
}

/** Drops ids that are no longer in the list and ids planned twice. */
export function reconcilePlan(plan: Plan, placeIds: string[]): Plan {
  const valid = new Set(placeIds);
  const seen = new Set<string>();
  const days: Record<string, string[]> = {};
  for (let d = 1; d <= MAX_DAYS; d++) {
    const ids = (plan.days[String(d)] ?? []).filter((id) => valid.has(id) && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (ids.length) days[String(d)] = ids;
  }
  return { dayCount: plan.dayCount, days };
}

/** Great-circle (straight-line, "kuş uçuşu") distance in metres. */
export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371008.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const hasCoord = (p: PlanPlace): p is PlanPlace & { lat: number; lon: number } => p.lat !== null && p.lon !== null;

function dist(a: PlanPlace, b: PlanPlace): number {
  if (!hasCoord(a) || !hasCoord(b)) return 0;
  return distanceMeters(a, b);
}

/**
 * Port of RoutePlanner.nearestNeighborOrder (Voyage/Services/RoutePlanner.swift):
 * start at the hotel if there is one (else the first located place), repeatedly go to the
 * closest remaining place; places without coordinates keep their order at the end.
 */
export function nearestNeighborOrder<T extends PlanPlace>(places: T[]): T[] {
  const located = places.filter(hasCoord);
  const unlocated = places.filter((p) => !hasCoord(p));
  let current = located.find((p) => p.category === 'hotel') ?? located[0];
  if (!current) return places;
  let remaining = located.filter((p) => p !== current);
  const ordered: T[] = [current];
  while (remaining.length) {
    let next = remaining[0];
    let best = dist(current, next);
    for (const p of remaining.slice(1)) {
      const d = dist(current, p);
      if (d < best) { best = d; next = p; }
    }
    ordered.push(next);
    remaining = remaining.filter((p) => p !== next);
    current = next;
  }
  return [...ordered, ...unlocated];
}

/** Port of RoutePlanner.totalDistance: sum of consecutive legs (unlocated legs count 0). */
export function totalDistance(places: PlanPlace[]): number {
  let sum = 0;
  for (let i = 1; i < places.length; i++) sum += dist(places[i - 1], places[i]);
  return sum;
}

export function legDistance(a: PlanPlace, b: PlanPlace): number | null {
  return hasCoord(a) && hasCoord(b) ? distanceMeters(a, b) : null;
}

/** "850 m" / "3,8 km" (Turkish decimal comma). */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}
