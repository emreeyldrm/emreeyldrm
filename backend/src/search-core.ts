// Place search core (docs/ACCEPTANCE.md, "Yer arama (SRCH)").
//
// THIS FILE IS SHARED VERBATIM between server/src/search/search-core.ts (NestJS) and
// backend/src/search-core.ts (Cloudflare Worker). Edit one, then copy it over the other:
//   cp server/src/search/search-core.ts backend/src/search-core.ts
// server/test/unit/search-core.spec.ts fails if the two copies differ.
//
// It has no framework or runtime dependencies: `fetch` is passed in, so it runs on Node and on workerd.

export type Category =
  | 'food' | 'coffee' | 'bar' | 'historic' | 'museum' | 'park' | 'beach' | 'hotel' | 'airport' | 'other'

export interface SearchResult {
  provider: string
  providerId: string
  name: string
  address: string
  lat: number
  lon: number
  category: Category
}

export interface LatLon { lat: number; lon: number }
export interface SearchQuery { q: string; near: LatLon | null }

/** Provider selection: SEARCH_PROVIDER (fake | photon | google) wins; else Google if a key is set; else Photon. */
export interface SearchEnv { SEARCH_PROVIDER?: string; GOOGLE_PLACES_API_KEY?: string }
export type ProviderName = 'google' | 'photon' | 'fake'

/** Minimal fetch signature implemented by both Node's and workerd's global fetch. */
export type FetchLike = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** 400 for bad input, 502 when the provider fails. The message never contains the API key. */
export class SearchError extends Error {
  constructor(public status: 400 | 502, message: string) { super(message) }
}

export const MAX_RESULTS = 8
/** With a location we fetch a bigger pool and return the nearest MAX_RESULTS (providers only bias, not sort). */
export const NEAR_POOL = 30
export const GOOGLE_MAX_POOL = 20
export const PROVIDER_TIMEOUT_MS = 5000
export const BIAS_RADIUS_M = 20000
export const USER_AGENT = 'Voyage/1.0 (travel list app; https://github.com/emreeyldrm)'
export const GOOGLE_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types'

// ---------- Input ----------

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/** Validates `q`, `lat`, `lon` query parameters. lat/lon are optional but must come together and be valid. */
export function parseSearchQuery(q: unknown, lat: unknown, lon: unknown): SearchQuery {
  const text = typeof q === 'string' ? q.trim() : ''
  if (text.length < 2) throw new SearchError(400, 'q en az 2 karakter olmalı')
  if (text.length > 200) throw new SearchError(400, 'q en çok 200 karakter olabilir')
  if (blank(lat) && blank(lon)) return { q: text, near: null }
  const a = typeof lat === 'string' ? Number(lat) : NaN
  const b = typeof lon === 'string' ? Number(lon) : NaN
  if (blank(lat) || blank(lon) || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180)
    throw new SearchError(400, 'lat ve lon birlikte ve geçerli sayı olmalı')
  return { q: text, near: { lat: a, lon: b } }
}

export function pickProvider(env: SearchEnv): ProviderName {
  const forced = (env.SEARCH_PROVIDER ?? '').trim().toLowerCase()
  if (forced === 'fake' || forced === 'photon') return forced
  if (forced === 'google') return 'google'
  return env.GOOGLE_PLACES_API_KEY ? 'google' : 'photon'
}

// ---------- Category mapping ----------

const GOOGLE_EXACT: Record<string, Category> = {
  restaurant: 'food', meal_takeaway: 'food', meal_delivery: 'food', bakery: 'food', food_court: 'food',
  cafe: 'coffee', coffee_shop: 'coffee', tea_house: 'coffee',
  bar: 'bar', night_club: 'bar', pub: 'bar', wine_bar: 'bar',
  museum: 'museum', art_gallery: 'museum',
  historical_landmark: 'historic', historical_place: 'historic', monument: 'historic', church: 'historic',
  mosque: 'historic', synagogue: 'historic', hindu_temple: 'historic', place_of_worship: 'historic',
  park: 'park', national_park: 'park', garden: 'park', botanical_garden: 'park', state_park: 'park',
  beach: 'beach',
  lodging: 'hotel', hotel: 'hotel', hostel: 'hotel', motel: 'hotel', resort_hotel: 'hotel',
  bed_and_breakfast: 'hotel', guest_house: 'hotel',
  airport: 'airport', international_airport: 'airport',
}

/** One Google place type -> our category, or null when the type says nothing (e.g. point_of_interest). */
function googleType(t: string): Category | null {
  if (GOOGLE_EXACT[t]) return GOOGLE_EXACT[t]
  if (t.endsWith('_restaurant')) return 'food'
  return null
}

/**
 * Google Places (New) `primaryType` / `types` -> one of our 10 categories. The primary type wins; otherwise the
 * first meaningful entry of `types`. A bare `tourist_attraction` is not enough for `historic`: it counts only
 * together with a historical / monument / worship type (which map on their own).
 */
export function categoryFromGoogle(primaryType: string | null | undefined, types: readonly string[] | null | undefined): Category {
  const all = [primaryType ?? '', ...(types ?? [])].filter(Boolean)
  for (const t of all) {
    const c = googleType(t)
    if (c) return c
  }
  return 'other'
}

const OSM: Record<string, Record<string, Category>> = {
  amenity: {
    restaurant: 'food', fast_food: 'food', food_court: 'food',
    cafe: 'coffee',
    bar: 'bar', pub: 'bar', biergarten: 'bar', nightclub: 'bar',
    place_of_worship: 'historic',
  },
  shop: { bakery: 'food' },
  tourism: {
    museum: 'museum', gallery: 'museum',
    hotel: 'hotel', hostel: 'hotel', guest_house: 'hotel', motel: 'hotel',
  },
  leisure: { park: 'park', garden: 'park' },
  natural: { beach: 'beach' },
  aeroway: { aerodrome: 'airport' },
}

/** OpenStreetMap `osm_key` / `osm_value` (Photon) -> one of our 10 categories. Every `historic=*` is historic. */
export function categoryFromOsm(key: string | null | undefined, value: string | null | undefined): Category {
  if (!key) return 'other'
  if (key === 'historic') return 'historic'
  return OSM[key]?.[value ?? ''] ?? 'other'
}

// ---------- Helpers ----------

/** Case- and diacritic-insensitive form (Turkish dotless ı and dotted İ included). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ı/g, 'i')
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

// ---------- Google Places (New) Text Search ----------

export function googleRequest(query: SearchQuery, key: string) {
  const body: Record<string, unknown> = {
    textQuery: query.q, languageCode: 'tr', maxResultCount: query.near ? GOOGLE_MAX_POOL : MAX_RESULTS,
  }
  if (query.near) {
    body.locationBias = {
      circle: { center: { latitude: query.near.lat, longitude: query.near.lon }, radius: BIAS_RADIUS_M },
    }
  }
  return {
    url: 'https://places.googleapis.com/v1/places:searchText',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELD_MASK },
      body: JSON.stringify(body),
    },
  }
}

export function parseGoogle(json: unknown, max = MAX_RESULTS): SearchResult[] {
  const places = obj(json).places
  if (!Array.isArray(places)) return []
  const out: SearchResult[] = []
  for (const raw of places) {
    const p = obj(raw)
    const loc = obj(p.location)
    const lat = num(loc.latitude)
    const lon = num(loc.longitude)
    const id = str(p.id)
    const name = str(obj(p.displayName).text)
    if (!id || !name || lat === null || lon === null) continue
    const types = Array.isArray(p.types) ? p.types.filter((t): t is string => typeof t === 'string') : []
    out.push({
      provider: 'google', providerId: id, name, address: str(p.formattedAddress), lat, lon,
      category: categoryFromGoogle(str(p.primaryType), types),
    })
  }
  return out.slice(0, max)
}

// ---------- Photon (OpenStreetMap) ----------

export function photonUrl(query: SearchQuery): string {
  const params = [`q=${encodeURIComponent(query.q)}`, `limit=${query.near ? NEAR_POOL : MAX_RESULTS}`]
  if (query.near) params.push(`lat=${query.near.lat}`, `lon=${query.near.lon}`)
  return `https://photon.komoot.io/api/?${params.join('&')}`
}

export function parsePhoton(json: unknown, max = MAX_RESULTS): SearchResult[] {
  const features = obj(json).features
  if (!Array.isArray(features)) return []
  const out: SearchResult[] = []
  for (const raw of features) {
    const f = obj(raw)
    const coords = obj(f.geometry).coordinates
    const p = obj(f.properties)
    if (!Array.isArray(coords)) continue
    const lon = num(coords[0])
    const lat = num(coords[1])
    const osmType = str(p.osm_type)
    const osmId = typeof p.osm_id === 'number' ? String(p.osm_id) : str(p.osm_id)
    const street = [str(p.street), str(p.housenumber)].filter(Boolean).join(' ')
    const name = str(p.name) || street
    if (lat === null || lon === null || !osmType || !osmId || !name) continue
    const address = [street !== name ? street : '', str(p.city), str(p.country)]
      .filter((s, i, all) => s && s !== name && all.indexOf(s) === i).join(', ')
    out.push({
      provider: 'osm', providerId: `${osmType}${osmId}`, name, address, lat, lon,
      category: categoryFromOsm(str(p.osm_key), str(p.osm_value)),
    })
  }
  return out.slice(0, max)
}

// ---------- Fake provider (tests: SEARCH_PROVIDER=fake) ----------

export const FAKE_PLACES: readonly SearchResult[] = [
  { provider: 'fake', providerId: 'fake-colosseo', name: 'Colosseo', address: 'Piazza del Colosseo 1, Roma, İtalya', lat: 41.8902, lon: 12.4922, category: 'historic' },
  { provider: 'fake', providerId: 'fake-musei-vaticani', name: 'Musei Vaticani', address: 'Viale Vaticano, Roma, İtalya', lat: 41.9065, lon: 12.4536, category: 'museum' },
  { provider: 'fake', providerId: 'fake-roscioli', name: 'Roscioli Salumeria', address: 'Via dei Giubbonari 21, Roma, İtalya', lat: 41.8937, lon: 12.4731, category: 'food' },
  { provider: 'fake', providerId: 'fake-santeustachio', name: "Sant'Eustachio Il Caffè", address: "Piazza di Sant'Eustachio 82, Roma, İtalya", lat: 41.8986, lon: 12.4755, category: 'coffee' },
  { provider: 'fake', providerId: 'fake-villa-borghese', name: 'Villa Borghese', address: 'Piazzale Napoleone I, Roma, İtalya', lat: 41.9142, lon: 12.4923, category: 'park' },
  { provider: 'fake', providerId: 'fake-hilton-roma', name: 'Hilton Rome Airport', address: 'Via Arturo Ferrarin 2, Fiumicino, İtalya', lat: 41.7935, lon: 12.2490, category: 'hotel' },
  { provider: 'fake', providerId: 'fake-ayasofya', name: 'Ayasofya', address: 'Sultan Ahmet, Ayasofya Meydanı 1, Fatih, İstanbul, Türkiye', lat: 41.0086, lon: 28.9802, category: 'historic' },
  { provider: 'fake', providerId: 'fake-galata', name: 'Galata Kulesi', address: 'Bereketzade, Galata Kulesi Sk., Beyoğlu, İstanbul, Türkiye', lat: 41.0256, lon: 28.9741, category: 'historic' },
  { provider: 'fake', providerId: 'fake-ciya', name: 'Çiya Sofrası', address: 'Caferağa, Güneşli Bahçe Sk. 43, Kadıköy, İstanbul, Türkiye', lat: 40.9894, lon: 29.0257, category: 'food' },
  { provider: 'fake', providerId: 'fake-kronotrop', name: 'Kronotrop', address: 'Cihangir, Firuzağa Cami Sk., Beyoğlu, İstanbul, Türkiye', lat: 41.0313, lon: 28.9786, category: 'coffee' },
  { provider: 'fake', providerId: 'fake-hilton-istanbul', name: 'Hilton İstanbul Bomonti', address: 'Silahşör Cd. 42, Şişli, İstanbul, Türkiye', lat: 41.0583, lon: 28.9798, category: 'hotel' },
  { provider: 'fake', providerId: 'fake-ist-airport', name: 'İstanbul Havalimanı', address: 'Tayakadın, Arnavutköy, İstanbul, Türkiye', lat: 41.2753, lon: 28.7519, category: 'airport' },
  { provider: 'fake', providerId: 'fake-kaputas', name: 'Kaputaş Plajı', address: 'Kalkan, Kaş, Antalya, Türkiye', lat: 36.2290, lon: 29.4490, category: 'beach' },
  { provider: 'fake', providerId: 'fake-bar-basso', name: 'Bar Basso', address: 'Via Plinio 39, Milano, İtalya', lat: 45.4790, lon: 9.2107, category: 'bar' },
]

/** Query that makes the fake provider fail (502), so clients can test their error state. */
export const FAKE_FAIL_QUERY = '__fail__'

/** Substring match on name or address (case/diacritic-insensitive); nearest first when `near` is given. */
export function fakeSearch(query: SearchQuery): SearchResult[] {
  if (query.q === FAKE_FAIL_QUERY) throw new SearchError(502, 'Arama sağlayıcısı yanıt vermedi')
  const needle = fold(query.q)
  const hits = FAKE_PLACES.filter((p) => fold(`${p.name} ${p.address}`).includes(needle))
  return nearestFirst(hits, query.near).slice(0, MAX_RESULTS).map((p) => ({ ...p }))
}

/** Nearest first when a location is known; otherwise the provider's own order. */
export function nearestFirst<T extends { lat: number; lon: number }>(items: readonly T[], near: SearchQuery['near']): T[] {
  if (!near) return [...items]
  return [...items].sort((a, b) => distanceM(near, a) - distanceM(near, b))
}

// ---------- Entry point ----------

async function fetchJson(fetchFn: FetchLike, url: string, init: Parameters<FetchLike>[1]): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  } catch {
    throw new SearchError(502, 'Arama sağlayıcısına ulaşılamadı')
  }
  if (!res.ok) throw new SearchError(502, `Arama sağlayıcısı hata verdi (${res.status})`)
  try {
    return await res.json()
  } catch {
    throw new SearchError(502, 'Arama sağlayıcısının yanıtı okunamadı')
  }
}

/** Runs the search with the provider chosen by `env`. Throws SearchError (400/502). */
export async function searchPlaces(env: SearchEnv, query: SearchQuery, fetchFn: FetchLike): Promise<SearchResult[]> {
  const provider = pickProvider(env)
  if (provider === 'fake') return fakeSearch(query)
  if (provider === 'google') {
    const key = env.GOOGLE_PLACES_API_KEY
    if (!key) throw new SearchError(502, 'Google Places anahtarı tanımlı değil')
    const { url, init } = googleRequest(query, key)
    const pool = parseGoogle(await fetchJson(fetchFn, url, init), GOOGLE_MAX_POOL)
    return nearestFirst(pool, query.near).slice(0, MAX_RESULTS)
  }
  const pool = parsePhoton(await fetchJson(fetchFn, photonUrl(query), {
    method: 'GET', headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  }), NEAR_POOL)
  return nearestFirst(pool, query.near).slice(0, MAX_RESULTS)
}
