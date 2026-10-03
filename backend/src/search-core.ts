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
/** `lang`: arayan cihazın dili (2 harf, ör. "en"); sağlayıcı destekliyorsa sonuç adları bu dilde gelir. */
export interface SearchQuery { q: string; near: LatLon | null; lang?: string }

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
export function parseSearchQuery(q: unknown, lat: unknown, lon: unknown, lang?: unknown): SearchQuery {
  const parsed = parseQueryAndNear(q, lat, lon)
  const l = typeof lang === 'string' ? lang.trim().toLowerCase().slice(0, 2) : ''
  return /^[a-z]{2}$/.test(l) ? { ...parsed, lang: l } : parsed
}

function parseQueryAndNear(q: unknown, lat: unknown, lon: unknown): SearchQuery {
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

// ---------- Tür kelimeleri ("restaurant la campana" -> tür: yemek, ad: "la campana") ----------
// OpenStreetMap adları yerel dildedir ("Cervecería La Campana"); kullanıcı ise türü adın başına ekleyerek arar.
// Bu kelimeleri ayırıp adı tür süzgeciyle ayrıca ararız. Google bunu kendisi yapar, ona dokunmayız.

interface CategoryWord { category: Category; osm: readonly string[] }
const FOOD = { category: 'food', osm: ['amenity:restaurant', 'amenity:fast_food', 'amenity:food_court'] } as const
const COFFEE = { category: 'coffee', osm: ['amenity:cafe'] } as const
const BAR = { category: 'bar', osm: ['amenity:bar', 'amenity:pub', 'amenity:biergarten'] } as const
const HOTEL = { category: 'hotel', osm: ['tourism:hotel', 'tourism:hostel', 'tourism:guest_house'] } as const
const MUSEUM = { category: 'museum', osm: ['tourism:museum', 'tourism:gallery'] } as const
const PARK = { category: 'park', osm: ['leisure:park', 'leisure:garden'] } as const
const BEACH = { category: 'beach', osm: ['natural:beach', 'leisure:beach_resort'] } as const
const AIRPORT = { category: 'airport', osm: ['aeroway:aerodrome'] } as const

/** Katlanmış (fold) kelime -> tür. Türkçe, İngilizce, İspanyolca, İtalyanca, Fransızca, Almanca, Portekizce. */
export const CATEGORY_WORDS: Record<string, CategoryWord> = {
  restaurant: FOOD, restaurants: FOOD, restoran: FOOD, restorant: FOOD, lokanta: FOOD, restaurante: FOOD, ristorante: FOOD,
  cafe: COFFEE, kafe: COFFEE, kahve: COFFEE, kahveci: COFFEE, coffee: COFFEE, cafeteria: COFFEE, caffe: COFFEE, kaffee: COFFEE,
  bar: BAR, pub: BAR, meyhane: BAR, birahane: BAR,
  hotel: HOTEL, otel: HOTEL, hostel: HOTEL, pansiyon: HOTEL, hotels: HOTEL,
  museum: MUSEUM, muze: MUSEUM, museo: MUSEUM, musee: MUSEUM, museu: MUSEUM,
  park: PARK,
  beach: BEACH, plaj: BEACH, playa: BEACH, plage: BEACH, spiaggia: BEACH, praia: BEACH, strand: BEACH,
  airport: AIRPORT, havalimani: AIRPORT, havaalani: AIRPORT, aeropuerto: AIRPORT, aeroporto: AIRPORT, aeroport: AIRPORT, flughafen: AIRPORT,
}

export interface SearchIntent { rest: string; category: Category; osm: readonly string[] }

/** Sorgudaki tür kelimesini ayırır. Tür kelimesi yoksa ya da geriye ad kalmıyorsa null. */
export function splitIntent(q: string): SearchIntent | null {
  const words = q.trim().split(/\s+/)
  let hit: CategoryWord | null = null
  const rest: string[] = []
  for (const w of words) {
    const cw = CATEGORY_WORDS[fold(w)]
    if (cw && !hit) hit = cw
    else rest.push(w)
  }
  const restText = rest.join(' ').trim()
  return hit && restText.length >= 2 ? { rest: restText, category: hit.category, osm: hit.osm } : null
}

/** Önce türü ve adı tutanlar, sonra düz arama; aynı yer bir kez. */
function mergeGroups(groups: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const g of groups) for (const r of g) {
    const k = `${r.provider}:${r.providerId}`
    if (!seen.has(k)) { seen.add(k); out.push(r) }
  }
  return out.slice(0, MAX_RESULTS)
}

// ---------- Google Places (New) Text Search ----------

export function googleRequest(query: SearchQuery, key: string) {
  const body: Record<string, unknown> = {
    textQuery: query.q, languageCode: query.lang ?? 'tr', maxResultCount: query.near ? GOOGLE_MAX_POOL : MAX_RESULTS,
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

/** Photon'un ad çevirisi verdiği diller; diğerlerinde yerel ad ("default") kullanılır. */
export const PHOTON_LANGS = ['en', 'de', 'fr']

export function photonUrl(query: SearchQuery, osmTags: readonly string[] = []): string {
  const params = [`q=${encodeURIComponent(query.q)}`, `limit=${query.near ? NEAR_POOL : MAX_RESULTS}`]
  if (query.near) params.push(`lat=${query.near.lat}`, `lon=${query.near.lon}`)
  if (query.lang && PHOTON_LANGS.includes(query.lang)) params.push(`lang=${query.lang}`)
  for (const t of osmTags) params.push(`osm_tag=${encodeURIComponent(t)}`)
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
  { provider: 'fake', providerId: 'fake-la-campana', name: 'Cervecería La Campana', address: 'Calle Botoneras 6, Madrid, España', lat: 40.4148, lon: -3.7076, category: 'food' },
  { provider: 'fake', providerId: 'fake-campana-cafe', name: 'Café La Campana', address: 'Calle Mayor 10, Madrid, España', lat: 40.4160, lon: -3.7080, category: 'coffee' },
  { provider: 'fake', providerId: 'fake-bar-basso', name: 'Bar Basso', address: 'Via Plinio 39, Milano, İtalya', lat: 45.4790, lon: 9.2107, category: 'bar' },
]

/** Query that makes the fake provider fail (502), so clients can test their error state. */
export const FAKE_FAIL_QUERY = '__fail__'

/** Substring match on name or address (case/diacritic-insensitive); nearest first when `near` is given. */
export function fakeSearch(query: SearchQuery): SearchResult[] {
  if (query.q === FAKE_FAIL_QUERY) throw new SearchError(502, 'Arama sağlayıcısı yanıt vermedi')
  const match = (q: string) => FAKE_PLACES.filter((p) => fold(`${p.name} ${p.address}`).includes(fold(q)))
  const plain = nearestFirst(match(query.q), query.near)
  const intent = splitIntent(query.q)
  const typed = intent ? nearestFirst(match(intent.rest).filter((p) => p.category === intent.category), query.near) : []
  return mergeGroups([typed, plain]).map((p) => ({ ...p }))
}

/** Nearest first when a location is known; otherwise the provider's own order. */
export function nearestFirst<T extends { lat: number; lon: number }>(items: readonly T[], near: SearchQuery['near']): T[] {
  if (!near) return [...items]
  return [...items].sort((a, b) => distanceM(near, a) - distanceM(near, b))
}

// ---------- Yakındaki yerler (TAP: haritaya dokunma) ----------
// `GET /search/nearby?lat=&lon=&lang=`: dokunulan noktanın çevresindeki adlandırılmış yerler, en yakından uzağa.

export interface NearbyQuery { near: LatLon; lang?: string }

/** Sağlayıcıdan gelen sonuçlardan bu yarıçaptan uzak olanlar atılır. */
export const NEARBY_RADIUS_M = 150
/** Fake sağlayıcı (testler) fikstürler arasından bu yarıçap içindekileri döner. */
export const FAKE_NEARBY_RADIUS_M = 300
export const PHOTON_REVERSE_LIMIT = 20
export const GOOGLE_NEARBY_MAX = 10

/** lat/lon zorunlu ve geçerli aralıkta; `lang` isteğe bağlı (geçersizse yok sayılır). */
export function parseNearbyQuery(lat: unknown, lon: unknown, lang?: unknown): NearbyQuery {
  const a = typeof lat === 'string' && lat.trim() !== '' ? Number(lat) : NaN
  const b = typeof lon === 'string' && lon.trim() !== '' ? Number(lon) : NaN
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180)
    throw new SearchError(400, 'lat ve lon geçerli sayı olmalı')
  const l = typeof lang === 'string' ? lang.trim().toLowerCase().slice(0, 2) : ''
  return /^[a-z]{2}$/.test(l) ? { near: { lat: a, lon: b }, lang: l } : { near: { lat: a, lon: b } }
}

/** Yer sayılan OSM anahtarları; sokak (highway), bina, yerleşim (place), sınır ve adres sonuçları elenir. */
const OSM_POI_KEYS = ['amenity', 'tourism', 'leisure', 'historic', 'shop', 'aeroway', 'craft', 'office']
/** Bu anahtarlarda yer olmayan (sokak mobilyası, otopark vb.) değerler. */
const OSM_NON_POI: Record<string, readonly string[]> = {
  amenity: ['parking', 'parking_entrance', 'parking_space', 'bicycle_parking', 'motorcycle_parking', 'bench',
    'waste_basket', 'waste_disposal', 'recycling', 'vending_machine', 'post_box', 'telephone', 'drinking_water',
    'fountain', 'clock', 'shelter', 'bicycle_rental', 'charging_station', 'atm', 'taxi', 'toilets'],
  tourism: ['information'],
  leisure: ['pitch', 'playground', 'picnic_table', 'swimming_pool', 'track', 'fitness_station'],
  aeroway: ['gate', 'taxiway', 'runway', 'apron', 'holding_position', 'parking_position', 'navigationaid', 'windsock'],
}

/** Photon `osm_key` / `osm_value` bir işletme ya da gezilecek yer mi? (`natural` yalnızca plaj.) */
export function isOsmPoi(key: string | null | undefined, value: string | null | undefined): boolean {
  if (!key) return false
  if (key === 'natural') return value === 'beach'
  if (!OSM_POI_KEYS.includes(key)) return false
  return !(OSM_NON_POI[key] ?? []).includes(value ?? '')
}

export function photonReverseUrl(query: NearbyQuery): string {
  const params = [`lat=${query.near.lat}`, `lon=${query.near.lon}`, `limit=${PHOTON_REVERSE_LIMIT}`,
    `radius=${NEARBY_RADIUS_M / 1000}`]
  if (query.lang && PHOTON_LANGS.includes(query.lang)) params.push(`lang=${query.lang}`)
  return `https://photon.komoot.io/reverse?${params.join('&')}`
}

/** Yalnızca kendi adı olan yer sonuçları; NEARBY_RADIUS_M içinde, en yakından uzağa, en çok 8. */
export function parsePhotonNearby(json: unknown, near: LatLon): SearchResult[] {
  const features = obj(json).features
  if (!Array.isArray(features)) return []
  const pois = features.filter((raw) => {
    const p = obj(obj(raw).properties)
    return str(p.name) !== '' && isOsmPoi(str(p.osm_key), str(p.osm_value))
  })
  return withinRadius(parsePhoton({ features: pois }, pois.length), near, NEARBY_RADIUS_M)
}

/** Google'da yer olmayan (adres, sokak, yerleşim) birincil türler. */
const GOOGLE_NON_POI = ['street_address', 'route', 'premise', 'subpremise', 'locality', 'sublocality', 'political',
  'neighborhood', 'postal_code', 'administrative_area_level_1', 'administrative_area_level_2', 'country', 'plus_code',
  'geocode', 'intersection', 'parking']

export function googleNearbyRequest(query: NearbyQuery, key: string) {
  return {
    url: 'https://places.googleapis.com/v1/places:searchNearby',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELD_MASK },
      body: JSON.stringify({
        locationRestriction: {
          circle: { center: { latitude: query.near.lat, longitude: query.near.lon }, radius: NEARBY_RADIUS_M },
        },
        rankPreference: 'DISTANCE',
        maxResultCount: GOOGLE_NEARBY_MAX,
        languageCode: query.lang ?? 'tr',
      }),
    },
  }
}

export function parseGoogleNearby(json: unknown, near: LatLon): SearchResult[] {
  const places = obj(json).places
  const poi = Array.isArray(places)
    ? places.filter((raw) => !GOOGLE_NON_POI.includes(str(obj(raw).primaryType)))
    : []
  return withinRadius(parseGoogle({ places: poi }, poi.length), near, NEARBY_RADIUS_M)
}

/** Fikstürler içinden FAKE_NEARBY_RADIUS_M içindekiler, en yakından uzağa. */
export function fakeNearby(query: NearbyQuery): SearchResult[] {
  return withinRadius(FAKE_PLACES, query.near, FAKE_NEARBY_RADIUS_M).map((p) => ({ ...p }))
}

function withinRadius<T extends { lat: number; lon: number }>(items: readonly T[], near: LatLon, radiusM: number): T[] {
  return nearestFirst(items.filter((p) => distanceM(near, p) <= radiusM), near).slice(0, MAX_RESULTS)
}

/** Dokunulan noktanın yakınındaki yerler (sağlayıcı `env`'e göre). Throws SearchError (502). */
export async function searchNearby(env: SearchEnv, query: NearbyQuery, fetchFn: FetchLike): Promise<SearchResult[]> {
  const provider = pickProvider(env)
  if (provider === 'fake') return fakeNearby(query)
  if (provider === 'google') {
    const key = env.GOOGLE_PLACES_API_KEY
    if (!key) throw new SearchError(502, 'Google Places anahtarı tanımlı değil')
    const { url, init } = googleNearbyRequest(query, key)
    return parseGoogleNearby(await fetchJson(fetchFn, url, init), query.near)
  }
  const json = await fetchJson(fetchFn, photonReverseUrl(query), {
    method: 'GET', headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  return parsePhotonNearby(json, query.near)
}

// ---------- POST /places/resolve girdisi (TAP) ----------

export const CATEGORY_LIST: readonly Category[] =
  ['food', 'coffee', 'bar', 'historic', 'museum', 'park', 'beach', 'hotel', 'airport', 'other']

export interface ResolveInput {
  provider: string; providerId: string; name: string; lat: number; lon: number; category: Category; city: string | null
}

/**
 * `{provider, providerId, name, lat, lon, category, city?}` doğrulanır. `voyage` (elle eklenen yer) kabul edilmez:
 * bu yerler yalnızca listeden gelir. Bilinmeyen kategori `other` olur (liste öğeleriyle aynı). Hata: SearchError(400).
 */
export function parseResolveInput(body: unknown): ResolveInput {
  const b = obj(body)
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const provider = text(b.provider, 40)
  const providerId = text(b.providerId, 300)
  const name = text(b.name, 200)
  if (!provider || !providerId || !name) throw new SearchError(400, 'provider, providerId ve name gerekli')
  if (provider === 'voyage') throw new SearchError(400, 'Elle eklenen yerler yalnızca listeden eklenir')
  const lat = num(b.lat)
  const lon = num(b.lon)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    throw new SearchError(400, 'lat ve lon geçerli sayı olmalı')
  if (typeof b.category !== 'string') throw new SearchError(400, 'category gerekli')
  if (b.city !== undefined && b.city !== null && typeof b.city !== 'string') throw new SearchError(400, 'city metin olmalı')
  const category = (CATEGORY_LIST as readonly string[]).includes(b.category) ? (b.category as Category) : 'other'
  const city = text(b.city, 100) || null
  return { provider, providerId, name, lat, lon, category, city }
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
  const photon = async (q: SearchQuery, tags: readonly string[] = []) =>
    nearestFirst(parsePhoton(await fetchJson(fetchFn, photonUrl(q, tags), {
      method: 'GET', headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    }), NEAR_POOL), query.near)
  const intent = splitIntent(query.q)
  if (!intent) return (await photon(query)).slice(0, MAX_RESULTS)
  // "restaurant la campana": adı tür süzgeciyle ara; düz arama yalnızca yedek (hatası aramayı bozmaz).
  const [typed, plain] = await Promise.all([
    photon({ ...query, q: intent.rest }, intent.osm),
    photon(query).catch(() => [] as SearchResult[]),
  ])
  return mergeGroups([typed, plain])
}
