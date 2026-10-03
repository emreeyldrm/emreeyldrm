// Plan improvements core (docs/ACCEPTANCE.md, "Plan iyileştirmeleri (PLN)"): walking routes and opening hours.
//
// THIS FILE IS SHARED VERBATIM between server/src/plan/plan-core.ts (NestJS) and backend/src/plan-core.ts
// (Cloudflare Worker). Edit one, then copy it over the other:
//   cp server/src/plan/plan-core.ts backend/src/plan-core.ts
// server/test/unit/plan-core.spec.ts fails if the two copies differ.
//
// No framework or runtime dependencies: `fetch` is passed in, so it runs on Node and on workerd. The servers only do
// the database part (place lookup, `place_hours` cache row read/write) around `resolveHours`.

// ---------- Shared types ----------

export interface LatLon { lat: number; lon: number }

/** Minimal fetch signature implemented by both Node's and workerd's global fetch. */
export type FetchLike = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** 400 for bad input, 404 unknown place, 502 when the provider fails. The message never contains an API key. */
export class PlanError extends Error {
  constructor(public status: 400 | 404 | 502, message: string) { super(message) }
}

/**
 * Provider configuration (server environment). Explicit ROUTING_PROVIDER / HOURS_PROVIDER win; otherwise
 * SEARCH_PROVIDER=fake (test servers) selects the fake providers too; otherwise real providers.
 */
export interface PlanEnv {
  ROUTING_PROVIDER?: string
  HOURS_PROVIDER?: string
  SEARCH_PROVIDER?: string
  GOOGLE_PLACES_API_KEY?: string
  GOOGLE_ROUTES_API_KEY?: string
  ROUTING_URL?: string
  OVERPASS_URL?: string
}

export const PROVIDER_TIMEOUT_MS = 8000
export const USER_AGENT = 'Voyage/1.0 (travel list app; https://github.com/emreeyldrm)'
export const DEFAULT_ROUTING_URL = 'https://routing.openstreetmap.de/routed-foot'
export const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const forced = (v: string | undefined) => (v ?? '').trim().toLowerCase()

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

async function fetchJson(fetchFn: FetchLike, url: string, init: Parameters<FetchLike>[1], what: string): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  } catch {
    throw new PlanError(502, `${what} sağlayıcısına ulaşılamadı`)
  }
  if (!res.ok) throw new PlanError(502, `${what} sağlayıcısı hata verdi (${res.status})`)
  try {
    return await res.json()
  } catch {
    throw new PlanError(502, `${what} sağlayıcısının yanıtı okunamadı`)
  }
}

// =====================================================================================================================
// Walking routes: GET /routes/walk?points=lat,lon;lat,lon;...
// =====================================================================================================================

export const MIN_POINTS = 2
export const MAX_POINTS = 25
/** Fake provider (tests): straight line × 1.3 at 4.8 km/h. */
export const FAKE_DETOUR = 1.3
export const WALK_SPEED_MPS = 4800 / 3600
/** Fake provider fails (502) when any point is exactly this one, so clients can test their fallback. */
export const FAKE_FAIL_POINT: LatLon = { lat: 0, lon: 0 }

export interface WalkLeg { distanceM: number; durationS: number }
export interface WalkRoute { legs: WalkLeg[]; totalDistanceM: number; totalDurationS: number; provider: RoutingProvider }
export type RoutingProvider = 'google' | 'osrm' | 'fake'

/** Parses `lat,lon;lat,lon;...` (2–25 valid points). Throws PlanError(400). */
export function parsePoints(raw: unknown): LatLon[] {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) throw new PlanError(400, 'points gerekli: lat,lon;lat,lon;...')
  const parts = text.split(';')
  if (parts.length < MIN_POINTS || parts.length > MAX_POINTS)
    throw new PlanError(400, `points ${MIN_POINTS}–${MAX_POINTS} nokta olmalı`)
  return parts.map((p) => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(p)
    const lat = m ? Number(m[1]) : NaN
    const lon = m ? Number(m[2]) : NaN
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      throw new PlanError(400, 'Her nokta "lat,lon" biçiminde geçerli sayılar olmalı')
    return { lat, lon }
  })
}

export function pickRoutingProvider(env: PlanEnv): RoutingProvider {
  const f = forced(env.ROUTING_PROVIDER)
  if (f === 'fake' || f === 'osrm' || f === 'google') return f
  if (forced(env.SEARCH_PROVIDER) === 'fake') return 'fake'
  return env.GOOGLE_ROUTES_API_KEY || env.GOOGLE_PLACES_API_KEY ? 'google' : 'osrm'
}

function route(legs: WalkLeg[], provider: RoutingProvider): WalkRoute {
  return {
    legs,
    totalDistanceM: legs.reduce((s, l) => s + l.distanceM, 0),
    totalDurationS: legs.reduce((s, l) => s + l.durationS, 0),
    provider,
  }
}

export function fakeWalk(points: LatLon[]): WalkRoute {
  if (points.some((p) => p.lat === FAKE_FAIL_POINT.lat && p.lon === FAKE_FAIL_POINT.lon))
    throw new PlanError(502, 'Rota sağlayıcısı yanıt vermedi')
  const legs: WalkLeg[] = []
  for (let i = 1; i < points.length; i++) {
    const d = distanceM(points[i - 1], points[i]) * FAKE_DETOUR
    legs.push({ distanceM: Math.round(d), durationS: Math.round(d / WALK_SPEED_MPS) })
  }
  return route(legs, 'fake')
}

// ---------- OSRM (routing.openstreetmap.de/routed-foot or any OSRM-compatible foot server) ----------

/** OSRM takes `lon,lat` pairs. The profile segment is informational for OSRM; the server's own profile is used. */
export function osrmUrl(points: LatLon[], base = DEFAULT_ROUTING_URL): string {
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(';')
  return `${base.replace(/\/+$/, '')}/route/v1/foot/${coords}?overview=false&steps=false`
}

export function parseOsrm(json: unknown, pointCount: number): WalkRoute {
  const j = obj(json)
  const first = Array.isArray(j.routes) ? obj(j.routes[0]) : {}
  const legs = Array.isArray(first.legs) ? first.legs : null
  if (str(j.code) !== 'Ok' || !legs || legs.length !== pointCount - 1)
    throw new PlanError(502, `Rota bulunamadı (${str(j.code) || 'yanıt yok'})`)
  return route(legs.map((raw) => {
    const l = obj(raw)
    return { distanceM: Math.round(num(l.distance) ?? 0), durationS: Math.round(num(l.duration) ?? 0) }
  }), 'osrm')
}

// ---------- Google Routes API (computeRoutes, WALK) ----------

export const GOOGLE_ROUTES_FIELD_MASK = 'routes.legs.distanceMeters,routes.legs.duration'

export function googleRoutesRequest(points: LatLon[], key: string) {
  const wp = (p: LatLon) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } })
  const body: Record<string, unknown> = {
    origin: wp(points[0]),
    destination: wp(points[points.length - 1]),
    travelMode: 'WALK',
    languageCode: 'tr',
    units: 'METRIC',
  }
  if (points.length > 2) body.intermediates = points.slice(1, -1).map(wp)
  return {
    url: 'https://routes.googleapis.com/directions/v2:computeRoutes',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_ROUTES_FIELD_MASK },
      body: JSON.stringify(body),
    },
  }
}

/** Google durations are strings like "754s"; a 0 m leg may omit distanceMeters. */
export function parseGoogleRoutes(json: unknown, pointCount: number): WalkRoute {
  const routes = obj(json).routes
  const legs = Array.isArray(routes) ? obj(routes[0]).legs : null
  if (!Array.isArray(legs) || legs.length !== pointCount - 1) throw new PlanError(502, 'Rota bulunamadı')
  return route(legs.map((raw) => {
    const l = obj(raw)
    const dur = /^(\d+(?:\.\d+)?)s$/.exec(str(l.duration))
    return { distanceM: Math.round(num(l.distanceMeters) ?? 0), durationS: dur ? Math.round(Number(dur[1])) : 0 }
  }), 'google')
}

/** Walking route through the points with the provider chosen by `env`. Throws PlanError (502). */
export async function walkRoute(env: PlanEnv, points: LatLon[], fetchFn: FetchLike): Promise<WalkRoute> {
  const provider = pickRoutingProvider(env)
  if (provider === 'fake') return fakeWalk(points)
  if (provider === 'google') {
    const key = env.GOOGLE_ROUTES_API_KEY || env.GOOGLE_PLACES_API_KEY
    if (!key) throw new PlanError(502, 'Google Routes anahtarı tanımlı değil')
    const { url, init } = googleRoutesRequest(points, key)
    return parseGoogleRoutes(await fetchJson(fetchFn, url, init, 'Rota'), points.length)
  }
  const json = await fetchJson(fetchFn, osrmUrl(points, env.ROUTING_URL || DEFAULT_ROUTING_URL), {
    method: 'GET', headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  }, 'Rota')
  return parseOsrm(json, points.length)
}

// =====================================================================================================================
// Opening hours: GET /places/:id/hours  ->  { openingHours: "<OSM opening_hours>" | null, source, fetchedAt }
// =====================================================================================================================

/** Cached rows (found or not found) are served for 7 days; after that the provider is asked again. */
export const HOURS_TTL_MS = 7 * 24 * 3600 * 1000

export type HoursSource = 'osm' | 'google' | 'fake' | 'none'
export interface HoursPlace { provider: string; providerId: string }
/** One `place_hours` row (both servers): opening_hours NULL = the provider has no hours for this place. */
export interface HoursRow { openingHours: string | null; source: HoursSource; fetchedAt: string }
export interface HoursResponse { openingHours: string | null; source: HoursSource; fetchedAt: string }

/**
 * Cache table, identical on both servers (Worker: migrations/0008_place_hours.sql adds the FK to places; NestJS runs
 * this statement at startup because the table is a cache and not a TypeORM entity).
 */
export const PLACE_HOURS_DDL = `CREATE TABLE IF NOT EXISTS place_hours (
  place_id INTEGER PRIMARY KEY,
  opening_hours TEXT,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL
)`
export const SELECT_HOURS_SQL =
  'SELECT opening_hours AS openingHours, source, fetched_at AS fetchedAt FROM place_hours WHERE place_id = ?1'
export const UPSERT_HOURS_SQL =
  `INSERT INTO place_hours (place_id, opening_hours, source, fetched_at) VALUES (?1, ?2, ?3, ?4)
   ON CONFLICT (place_id) DO UPDATE SET opening_hours = excluded.opening_hours, source = excluded.source,
     fetched_at = excluded.fetched_at`

export type HoursProvider = 'fake' | 'osm' | 'google' | 'none'

/** HOURS_PROVIDER (fake | osm | google) wins; SEARCH_PROVIDER=fake -> fake; else by the place's own provider. */
export function pickHoursProvider(env: PlanEnv, place: HoursPlace): HoursProvider {
  const f = forced(env.HOURS_PROVIDER)
  if (f === 'fake') return 'fake'
  if (f !== 'osm' && f !== 'google' && forced(env.SEARCH_PROVIDER) === 'fake') return 'fake'
  if (place.provider === 'osm' && f !== 'google') return 'osm'
  if (place.provider === 'google' && f !== 'osm' && env.GOOGLE_PLACES_API_KEY) return 'google'
  return 'none'
}

// ---------- Fake (tests) ----------

/**
 * Fake opening hours by providerId PREFIX (so tests can use unique ids like `fake-roscioli-<run>`). Ids containing
 * `__fail__` simulate a provider error (502); anything else has no hours (null).
 */
export const FAKE_HOURS: readonly [string, string][] = [
  ['fake-colosseo', 'Mo-Su 08:30-19:00'],
  ['fake-musei-vaticani', 'Mo-Sa 09:00-18:00; Su off; PH off'],
  ['fake-roscioli', 'Mo-Sa 12:30-16:00,19:00-23:00; Su off'],
  ['fake-santeustachio', 'Mo-Su 07:30-01:00'],
  ['fake-villa-borghese', '24/7'],
  ['fake-galata', 'Mo-Su 08:30-23:00'],
  ['fake-ayasofya', 'Mo-Su 09:00-19:30'],
  ['fake-ciya', 'Mo-Su 11:00-22:00'],
  ['fake-kronotrop', 'Mo-Fr 07:30-19:00; Sa,Su 09:00-19:00'],
  ['fake-bar-basso', 'Tu-Su 18:00-02:00; Mo off'],
  ['fake-hours-', 'Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off'],
]

export function fakeHours(place: HoursPlace): string | null {
  if (place.providerId.includes('__fail__')) throw new PlanError(502, 'Açılış saatleri sağlayıcısı yanıt vermedi')
  return FAKE_HOURS.find(([prefix]) => place.providerId.startsWith(prefix))?.[1] ?? null
}

// ---------- Overpass (OpenStreetMap) ----------

/** Photon/OSM providerId: `N123` (node), `W456` (way), `R789` (relation). Anything else -> null. */
export function overpassQuery(providerId: string): string | null {
  const m = /^([NWR])(\d{1,15})$/.exec(providerId.trim().toUpperCase())
  if (!m) return null
  const type = { N: 'node', W: 'way', R: 'relation' }[m[1] as 'N' | 'W' | 'R']
  return `[out:json][timeout:10];${type}(${m[2]});out tags;`
}

export function overpassRequest(providerId: string, base = DEFAULT_OVERPASS_URL) {
  const query = overpassQuery(providerId)
  if (!query) return null
  return {
    url: base,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body: `data=${encodeURIComponent(query)}`,
    },
  }
}

/** `elements[0].tags.opening_hours` (trimmed, max 255 chars) or null when the element or tag is missing. */
export function parseOverpass(json: unknown): string | null {
  const elements = obj(json).elements
  if (!Array.isArray(elements)) throw new PlanError(502, 'Açılış saatleri yanıtı okunamadı')
  const text = str(obj(obj(elements[0]).tags).opening_hours)
  return text ? text.slice(0, 255) : null
}

// ---------- Google Place Details (regularOpeningHours) ----------

export const GOOGLE_HOURS_FIELD_MASK = 'regularOpeningHours'

export function googleHoursRequest(placeId: string, key: string) {
  return {
    url: `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    init: { method: 'GET', headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_HOURS_FIELD_MASK } },
  }
}

/** OSM day names in Google's day order (0 = Sunday). */
const GOOGLE_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
/** OSM week order, Monday first. */
const OSM_WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/**
 * Google `regularOpeningHours.periods` -> OSM opening_hours text, e.g. "Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off".
 * Always-open (one period, Sunday 00:00, no close) -> "24/7". A period closing the next day becomes an overnight range
 * on its opening day ("18:00-02:00"); one spanning several days is split per day. `weekdayDescriptions` are localized
 * free text and are not parsed: without `periods` the result is null. Special days (holidays) are not represented.
 */
export function googlePeriodsToOsm(json: unknown): string | null {
  const periods = obj(obj(json).regularOpeningHours).periods
  if (!Array.isArray(periods) || periods.length === 0) return null
  const point = (v: unknown) => {
    const o = obj(v)
    const day = num(o.day)
    if (day === null || day < 0 || day > 6) return null
    return { day, min: (num(o.hour) ?? 0) * 60 + (num(o.minute) ?? 0) }
  }
  const first = obj(periods[0])
  const firstOpen = point(first.open)
  if (periods.length === 1 && firstOpen && firstOpen.min === 0 && !first.close) return '24/7'
  const byDay: string[][] = GOOGLE_DAYS.map(() => [])
  for (const raw of periods) {
    const p = obj(raw)
    const open = point(p.open)
    const close = point(p.close)
    if (!open || !close) continue
    const span = (close.day - open.day + 7) % 7
    if (span === 0 && close.min > open.min) byDay[open.day].push(`${hhmm(open.min)}-${hhmm(close.min)}`)
    else if (span === 1 && close.min <= 6 * 60) byDay[open.day].push(`${hhmm(open.min)}-${close.min === 0 ? '24:00' : hhmm(close.min)}`)
    else {
      const days = span === 0 ? 7 : span
      byDay[open.day].push(`${hhmm(open.min)}-24:00`)
      for (let i = 1; i < days; i++) byDay[(open.day + i) % 7].push('00:00-24:00')
      if (close.min > 0) byDay[close.day].push(`00:00-${hhmm(close.min)}`)
    }
  }
  const ranges = OSM_WEEK.map((d) => byDay[GOOGLE_DAYS.indexOf(d)].sort().join(',') || 'off')
  if (ranges.every((r) => r === 'off')) return null
  const groups: string[] = []
  for (let i = 0; i < 7;) {
    let j = i
    while (j + 1 < 7 && ranges[j + 1] === ranges[i]) j++
    const days = j === i ? OSM_WEEK[i] : j === i + 1 ? `${OSM_WEEK[i]},${OSM_WEEK[j]}` : `${OSM_WEEK[i]}-${OSM_WEEK[j]}`
    groups.push(`${days} ${ranges[i]}`)
    i = j + 1
  }
  return groups.join('; ')
}

/** Asks the provider for a place's opening_hours text (null = none). Throws PlanError(502). */
export async function fetchHours(env: PlanEnv, place: HoursPlace, fetchFn: FetchLike): Promise<{ openingHours: string | null; source: HoursSource }> {
  const provider = pickHoursProvider(env, place)
  if (provider === 'none') return { openingHours: null, source: 'none' }
  if (provider === 'fake') return { openingHours: fakeHours(place), source: 'fake' }
  if (provider === 'google') {
    const key = env.GOOGLE_PLACES_API_KEY
    if (!key) return { openingHours: null, source: 'none' }
    const { url, init } = googleHoursRequest(place.providerId, key)
    return { openingHours: googlePeriodsToOsm(await fetchJson(fetchFn, url, init, 'Açılış saatleri')), source: 'google' }
  }
  const req = overpassRequest(place.providerId, env.OVERPASS_URL || DEFAULT_OVERPASS_URL)
  if (!req) return { openingHours: null, source: 'osm' }
  return { openingHours: parseOverpass(await fetchJson(fetchFn, req.url, req.init, 'Açılış saatleri')), source: 'osm' }
}

export const isFresh = (row: HoursRow, now: Date) => {
  const t = Date.parse(row.fetchedAt)
  return Number.isFinite(t) && now.getTime() - t < HOURS_TTL_MS && t <= now.getTime() + 60_000
}

/**
 * Cache decision. A fresh cached row is returned without calling the provider. Otherwise the provider is asked and
 * `store` is the row to upsert. If the provider fails and a stale row exists, the stale row is served (no store);
 * without any row the PlanError(502) propagates. Google Place Details content is never stored (Google Maps Platform
 * terms do not allow caching Places content); those requests always go to Google.
 */
export async function resolveHours(
  env: PlanEnv, place: HoursPlace, cached: HoursRow | null, now: Date, fetchFn: FetchLike,
): Promise<{ response: HoursResponse; store: HoursRow | null }> {
  if (cached && isFresh(cached, now)) return { response: { ...cached }, store: null }
  try {
    const got = await fetchHours(env, place, fetchFn)
    const row: HoursRow = { ...got, fetchedAt: now.toISOString() }
    return { response: { ...row }, store: row.source === 'google' ? null : row }
  } catch (e) {
    if (cached && e instanceof PlanError && e.status === 502) return { response: { ...cached }, store: null }
    throw e
  }
}

/** Database row (snake_case or aliased) -> HoursRow; null when absent. */
export function readHoursRow(r: unknown): HoursRow | null {
  const o = obj(r)
  const fetchedAt = str(o.fetchedAt)
  if (!fetchedAt) return null
  const source = str(o.source) as HoursSource
  const text = typeof o.openingHours === 'string' && o.openingHours.trim() ? o.openingHours : null
  return { openingHours: text, source: (['osm', 'google', 'fake', 'none'] as string[]).includes(source) ? source : 'none', fetchedAt }
}
