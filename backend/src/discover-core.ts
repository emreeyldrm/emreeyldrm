// Keşfet: haftanın trendleri (TRD) — saf sıralama/puanlama mantığı.
// Bu dosya backend/src/discover-core.ts (Worker) ile server/src/discover/discover-core.ts (NestJS) arasında
// BİREBİR AYNIDIR; `server` içindeki `npm run test:unit` farkı yakalar. Veritabanına ve çalışma ortamına
// bağımlılığı yoktur: sunucular 7 günlük pencerede SQL ile toplar, burada puanlar ve sıralar.

/** Kayan pencere: istek anından geriye 7 gün. */
export const WINDOW_DAYS = 7
/** Bayes ortalaması: önsel ortalama ve ağırlığı (sanal puan sayısı). */
export const BAYES_PRIOR = 3.5
export const BAYES_WEIGHT = 3
/** "Haftanın restoranı" için en düşük ağırlıklı ortalama. */
export const PLACE_OF_WEEK_MIN = 3.5
export const PLACE_OF_WEEK_CATEGORY = 'food'
/** Her bölümde en çok kaç kart. */
export const SECTION_LIMIT = 10
/** El ile eklenen (arama sağlayıcısından gelmeyen) yerlerin sağlayıcısı. */
export const MANUAL_PROVIDER = 'voyage'
/** Testte zamanı değiştirmek için başlık; yalnızca E2E_TEST_HOOKS=1 iken dikkate alınır. */
export const TEST_NOW_HEADER = 'x-test-now'

/** Bir yerin pencere içi toplanmış sinyalleri ve tüm zamanların puan özeti (SQL çıktısı). */
export interface PlaceSignals {
  placeId: number
  name: string
  category: string
  city: string | null
  lat: number | null
  lon: number | null
  provider: string
  /** En az bir herkese açık listede geçiyor mu. */
  inPublicList: boolean
  views7d: number
  saves7d: number
  ratings7d: number
  comments7d: number
  /** Tüm zamanlar: puan adedi ve toplamı. */
  ratingCount: number
  ratingSum: number
}

export interface PlaceCard {
  placeId: number
  name: string
  category: string
  city: string | null
  lat: number | null
  lon: number | null
  avgStars: number | null
  ratingCount: number
  views7d: number
  saves7d: number
  score: number
}

export interface DiscoverHome {
  city: string
  placeOfWeek: PlaceCard | null
  trending: PlaceCard[]
  topRated: PlaceCard[]
  mostSearched: PlaceCard[]
  categoryCounts: Record<string, number>
}

/** Şehir karşılaştırma anahtarı: aksansız, küçük harf, İ/I/ı/i aynı (search-core `fold` ile aynı kural). */
export function foldCity(s: string): string {
  return s.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ı/g, 'i')
}

/** Aynı şehir mi (büyük/küçük harf ve aksan duyarsız). */
export const sameCity = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && foldCity(a) === foldCity(b) && foldCity(a) !== ''

/** Bayes (ağırlıklı) ortalama: (Σ + 3×3.5) / (n + 3). Puan yoksa önsel ortalama döner. */
export function bayesianAverage(sum: number, n: number): number {
  return (sum + BAYES_WEIGHT * BAYES_PRIOR) / (n + BAYES_WEIGHT)
}

/** Trend puanı (7 gün) = görüntüleme + 3×kaydetme + 2×puan + 2×yorum. */
export function trendScore(s: Pick<PlaceSignals, 'views7d' | 'saves7d' | 'ratings7d' | 'comments7d'>): number {
  return s.views7d + 3 * s.saves7d + 2 * s.ratings7d + 2 * s.comments7d
}

/** "En çok aranan" puanı (7 gün) = görüntüleme + kaydetme. */
export function searchScore(s: Pick<PlaceSignals, 'views7d' | 'saves7d'>): number {
  return s.views7d + s.saves7d
}

/**
 * Gizlilik: yalnızca arama sağlayıcısından gelen yerler (provider ≠ voyage) ya da en az bir herkese açık listede
 * geçen yerler gösterilir. Yalnızca özel listelerde elle eklenmiş yer hiçbir bölümde görünmez.
 */
export function isDiscoverable(provider: string, inPublicList: boolean): boolean {
  return provider !== MANUAL_PROVIDER || inPublicList
}

/** Bayes ortalaması 3.5 ve üstü, en az 1 puanlı, food kategorisinde, trend puanı > 0 olan yer aday olur. */
export function isPlaceOfWeekCandidate(s: PlaceSignals): boolean {
  return s.category === PLACE_OF_WEEK_CATEGORY && s.ratingCount >= 1 && trendScore(s) > 0
    && bayesianAverage(s.ratingSum, s.ratingCount) >= PLACE_OF_WEEK_MIN
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits

/** Ham ortalama, 1 ondalık (GET /places/:id ile aynı); puan yoksa null. */
export const avgStarsOf = (s: Pick<PlaceSignals, 'ratingSum' | 'ratingCount'>): number | null =>
  s.ratingCount ? round(s.ratingSum / s.ratingCount, 1) : null

export function toCard(s: PlaceSignals, score: number): PlaceCard {
  return {
    placeId: s.placeId, name: s.name, category: s.category, city: s.city, lat: s.lat, lon: s.lon,
    avgStars: avgStarsOf(s), ratingCount: s.ratingCount, views7d: s.views7d, saves7d: s.saves7d, score,
  }
}

/** Ad sırası: aksansız/küçük harf anahtarla, eşitse ham ad ve kimlik (her iki sunucuda aynı, Intl'e bağlı değil). */
function byName(a: PlaceSignals, b: PlaceSignals): number {
  const fa = foldCity(a.name), fb = foldCity(b.name)
  if (fa !== fb) return fa < fb ? -1 : 1
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.placeId - b.placeId
}

/** Puana göre azalan; eşitlikte daha çok puan (değerlendirme) adedi, sonra ad sırası. */
export function rankBy(items: readonly PlaceSignals[], score: (s: PlaceSignals) => number): PlaceSignals[] {
  return [...items].sort((a, b) => score(b) - score(a) || b.ratingCount - a.ratingCount || byName(a, b))
}

/** Pencere başlangıcı (ISO-8601): `now`dan 7 gün önce. */
export function windowStart(now: Date): string {
  return new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()
}

/** HOME_SQL parametreleri ?2, ?3: [now − 7 gün, now]. */
export const windowBounds = (now: Date): [string, string] => [windowStart(now), now.toISOString()]

/** Görüntüleme tekilleştirme günü (UTC, YYYY-MM-DD). Kaydetmelerde gün '' (kişi + yer için tek kayıt). */
export const eventDay = (now: Date): string => now.toISOString().slice(0, 10)

/**
 * İsteğin "şimdi"si. Yalnızca test kancası açıkken (ortam değişkeni E2E_TEST_HOOKS = '1') X-Test-Now başlığındaki
 * ISO tarih kullanılır; aksi halde (üretim) başlık yok sayılır ve gerçek saat döner.
 */
export function resolveNow(header: string | null | undefined, hooksEnv: string | null | undefined, real: Date = new Date()): Date {
  if (hooksEnv !== '1' || !header) return real
  const t = Date.parse(header)
  return Number.isFinite(t) ? new Date(t) : real
}

/** Toplanmış sinyallerden GET /discover/home yanıtı. `category` yalnızca topRated'i süzer. */
export function buildHome(city: string, rows: readonly PlaceSignals[], category?: string | null): DiscoverHome {
  const visible = rows.filter((r) => isDiscoverable(r.provider, r.inPublicList) && sameCity(r.city, city))

  const trendingAll = rankBy(visible.filter((r) => trendScore(r) > 0), trendScore)
  const trending = trendingAll.slice(0, SECTION_LIMIT).map((r) => toCard(r, trendScore(r)))

  const pow = trendingAll.find(isPlaceOfWeekCandidate)
  const placeOfWeek = pow ? toCard(pow, trendScore(pow)) : null

  const weighted = (r: PlaceSignals) => bayesianAverage(r.ratingSum, r.ratingCount)
  const topRated = rankBy(visible.filter((r) => r.ratingCount >= 1 && (!category || r.category === category)), weighted)
    .slice(0, SECTION_LIMIT).map((r) => toCard(r, round(weighted(r), 2)))

  const mostSearched = rankBy(visible.filter((r) => searchScore(r) > 0), searchScore)
    .slice(0, SECTION_LIMIT).map((r) => toCard(r, searchScore(r)))

  // Çipler: o şehirde herhangi bir bölüme girebilen (7 günde sinyali ya da en az bir puanı olan) yer sayısı.
  const categoryCounts: Record<string, number> = {}
  for (const r of visible) {
    if (trendScore(r) > 0 || r.ratingCount > 0) categoryCounts[r.category] = (categoryCounts[r.category] ?? 0) + 1
  }
  return { city, placeOfWeek, trending, topRated, mostSearched, categoryCounts }
}

/** Satırdaki sayısal alanları güvenle sayıya çevirir (D1 / better-sqlite3 farkları). */
export function toSignals(r: Record<string, unknown>): PlaceSignals {
  const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
  const opt = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    placeId: n(r.placeId), name: String(r.name ?? ''), category: String(r.category ?? 'other'),
    city: r.city === null || r.city === undefined ? null : String(r.city), lat: opt(r.lat), lon: opt(r.lon),
    provider: String(r.provider ?? ''), inPublicList: r.inPublicList === true || n(r.inPublicList) === 1,
    views7d: n(r.views7d), saves7d: n(r.saves7d), ratings7d: n(r.ratings7d), comments7d: n(r.comments7d),
    ratingCount: n(r.ratingCount), ratingSum: n(r.ratingSum),
  }
}

/**
 * Toplama sorgusu (SQLite; D1 ve better-sqlite3 aynı). Parametreler: ?1 = şehir adlarının JSON dizisi (veritabanındaki
 * ham yazılışlar, foldCity ile eşleşenler), ?2 = pencere başlangıcı, ?3 = pencere sonu (isteğin anı; ISO). Yalnızca o şehirde sinyali ya da puanı olan
 * yerler döner; gizlilik süzgeci ve puanlama buildHome'dadır.
 */
export const HOME_SQL = `
WITH cp AS (SELECT id FROM places WHERE city IN (SELECT value FROM json_each(?1))),
ev AS (SELECT place_id, SUM(kind = 'view') AS v, SUM(kind = 'save') AS s FROM place_events
       WHERE created_at >= ?2 AND created_at <= ?3 AND place_id IN (SELECT id FROM cp) GROUP BY place_id),
rt AS (SELECT place_id, COUNT(*) AS n, SUM(stars) AS total, SUM(updated_at >= ?2 AND updated_at <= ?3) AS recent FROM ratings
       WHERE place_id IN (SELECT id FROM cp) GROUP BY place_id),
cm AS (SELECT place_id, COUNT(*) AS n FROM comments
       WHERE created_at >= ?2 AND created_at <= ?3 AND hidden = 0 AND visibility = 'public' AND place_id IN (SELECT id FROM cp) GROUP BY place_id),
ids AS (SELECT place_id FROM ev UNION SELECT place_id FROM rt UNION SELECT place_id FROM cm)
SELECT p.id AS placeId, p.name, p.category, p.city, p.lat, p.lon, p.provider,
  EXISTS (SELECT 1 FROM list_items i JOIN lists l ON l.id = i.list_id
          WHERE i.place_id = p.id AND l.visibility = 'public') AS inPublicList,
  COALESCE(ev.v, 0) AS views7d, COALESCE(ev.s, 0) AS saves7d, COALESCE(rt.recent, 0) AS ratings7d,
  COALESCE(cm.n, 0) AS comments7d, COALESCE(rt.n, 0) AS ratingCount, COALESCE(rt.total, 0) AS ratingSum
FROM ids JOIN places p ON p.id = ids.place_id
LEFT JOIN ev ON ev.place_id = p.id LEFT JOIN rt ON rt.place_id = p.id LEFT JOIN cm ON cm.place_id = p.id`

/** Veritabanındaki farklı şehir yazılışlarından istenen şehirle eşleşenler (HOME_SQL ?1 için). */
export function matchingCities(requested: string, stored: readonly (string | null)[]): string[] {
  return stored.filter((c): c is string => sameCity(c, requested))
}
