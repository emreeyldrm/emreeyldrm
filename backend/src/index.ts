// Voyage API (Cloudflare Workers + Hono + D1).
// Sözleşme: docs/ACCEPTANCE.md. Aynı sözleşmenin referans uygulaması server/ (NestJS); oradaki e2e testleri
// `npm run test:contract` ile bu Worker'a karşı da çalışır. Tüm JSON alanları camelCase, tarihler ISO-8601.
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { sign, verify } from 'hono/jwt'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { parseSearchQuery, searchPlaces, SearchError } from './search-core'

type Env = {
  DB: D1Database; SESSION_SECRET: string; APPLE_BUNDLE_ID: string
  // Yer arama (SRCH): SEARCH_PROVIDER = fake | photon | google (isteğe bağlı); GOOGLE_PLACES_API_KEY gizli anahtar.
  SEARCH_PROVIDER?: string; GOOGLE_PLACES_API_KEY?: string
}
type Vars = { userId: number }
type AppEnv = { Bindings: Env; Variables: Vars }
type C = Context<AppEnv>
type Json = Record<string, unknown>

const app = new Hono<AppEnv>()

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
const CATEGORIES = ['food', 'coffee', 'bar', 'historic', 'museum', 'park', 'beach', 'hotel', 'airport', 'other']
const SESSION_DAYS = 30
const HANDLE_RE = /^[a-z0-9_]{3,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------- Yardımcılar ----------
type ErrStatus = 400 | 401 | 403 | 404 | 409 | 429 | 502
class ApiError extends Error {
  constructor(public status: ErrStatus, message: string) { super(message) }
}
const fail = (status: ErrStatus, message: string): never => { throw new ApiError(status, message) }

const now = () => new Date().toISOString()
const bool = (v: unknown) => v === 1 || v === true
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const absent = (v: unknown) => v === undefined || v === null

/** JSON gövdesi: boş gövde `{}` sayılır, bozuk JSON 400 verir. */
async function readBody(c: C): Promise<Json> {
  const text = await c.req.text()
  if (!text.trim()) return {}
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return fail(400, 'Geçersiz JSON') }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Json) : {}
}

/** Sayısal olmayan kimlikler 404 döner (NestJS ParseIntPipe ile aynı). */
function idParam(c: C, name = 'id'): number {
  const raw = c.req.param(name) ?? ''
  if (!/^-?\d+$/.test(raw)) fail(404, 'Bulunamadı')
  return Number(raw)
}

/** Kullanıcılar arasında (iki yönden biri) engel var mı: SQL koşulu. */
const blockedBetween = (a: string, b: string) =>
  `EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = ${a} AND bk.blocked_id = ${b})
                                      OR (bk.blocker_id = ${b} AND bk.blocked_id = ${a}))`

// ---------- Parola (PBKDF2-SHA256, Web Crypto) ----------
// workerd en çok 100.000 yinelemeye izin verir.
const PBKDF2_ITERATIONS = 100_000
const enc = new TextEncoder()
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

const DUMMY_SALT = new Uint8Array(16)
async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = (stored ?? '').split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') {
    // Kullanıcı yoksa da aynı işi yap: yanıt süresi e-postanın kayıtlı olup olmadığını sızdırmasın.
    await pbkdf2(password, DUMMY_SALT, PBKDF2_ITERATIONS)
    return false
  }
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false
  const expected = fromB64(parts[3])
  const actual = await pbkdf2(password, fromB64(parts[2]), iterations)
  return constantTimeEqual(actual, expected)
}

// ---------- Hata biçimi ----------
app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})
app.notFound((c) => c.json({ error: 'Bulunamadı' }, 404))
app.use('/*', cors())

// ---------- Kimlik ----------
type UserRow = { id: number; handle: string | null; email: string | null }

async function session(c: C, user: UserRow) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400
  const token = await sign({ sub: String(user.id), exp }, c.env.SESSION_SECRET)
  return { token, user: { id: user.id, handle: user.handle, email: user.email } }
}

const isUniqueViolation = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e))

app.post('/auth/register', async (c) => {
  const b = await readBody(c)
  if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email)) fail(400, 'email geçerli bir e-posta olmalı')
  if (typeof b.password !== 'string' || b.password.length < 8) fail(400, 'password en az 8 karakter olmalı')
  if (typeof b.handle !== 'string' || !HANDLE_RE.test(b.handle)) fail(400, 'handle must match ^[a-z0-9_]{3,20}$')
  const email = (b.email as string).trim().toLowerCase()
  const handle = b.handle as string
  const db = c.env.DB
  const clash = await db.prepare('SELECT email FROM users WHERE email = ?1 OR handle = ?2 LIMIT 1')
    .bind(email, handle).first<{ email: string | null }>()
  if (clash) fail(409, clash.email === email ? 'E-posta zaten kayıtlı' : 'Bu kullanıcı adı alınmış')
  const passwordHash = await hashPassword(b.password as string)
  let id: number
  try {
    const r = await db.prepare('INSERT INTO users (email, password_hash, handle, created_at) VALUES (?, ?, ?, ?)')
      .bind(email, passwordHash, handle, now()).run()
    id = Number(r.meta.last_row_id)
  } catch (e) {
    if (isUniqueViolation(e)) return fail(409, 'E-posta veya kullanıcı adı zaten kayıtlı')
    throw e
  }
  return c.json(await session(c, { id, handle, email }), 201)
})

app.post('/auth/login', async (c) => {
  const b = await readBody(c)
  if (!isNonEmptyString(b.email) || !isNonEmptyString(b.password)) fail(400, 'email ve password gerekli')
  const user = await c.env.DB.prepare('SELECT id, handle, email, password_hash FROM users WHERE email = ?')
    .bind((b.email as string).trim().toLowerCase()).first<UserRow & { password_hash: string | null }>()
  if (!(await verifyPassword(b.password as string, user?.password_hash ?? null)) || !user)
    fail(401, 'E-posta veya parola hatalı')
  return c.json(await session(c, user!))
})

// iOS, Apple ile girişten aldığı identityToken'ı gönderir; e-posta/parola ile aynı {token, user} döner.
// Apple kullanıcılarının e-postası ve (PUT /me ile seçene kadar) handle'ı boş olabilir.
app.post('/auth/apple', async (c) => {
  const { identityToken } = await readBody(c)
  if (!isNonEmptyString(identityToken)) fail(400, 'identityToken gerekli')
  let sub: string
  try {
    const { payload } = await jwtVerify(identityToken as string, appleKeys, {
      issuer: 'https://appleid.apple.com',
      audience: c.env.APPLE_BUNDLE_ID,
    })
    sub = String(payload.sub)
  } catch {
    return fail(403, 'Apple jetonu geçersiz')
  }
  await c.env.DB.prepare('INSERT OR IGNORE INTO users (apple_sub, created_at) VALUES (?, ?)').bind(sub, now()).run()
  const user = await c.env.DB.prepare('SELECT id, handle, email FROM users WHERE apple_sub = ?')
    .bind(sub).first<UserRow>()
  return c.json(await session(c, user!))
})

// Bundan sonrakiler oturum ister. Silinmiş hesabın jetonu da reddedilir.
app.use('/*', async (c, next) => {
  if (c.req.path.startsWith('/auth/')) return next()
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  let userId: number
  try {
    const payload = await verify(token, c.env.SESSION_SECRET, 'HS256')
    userId = Number(payload.sub)
  } catch {
    return fail(401, 'Oturum gerekli')
  }
  if (!Number.isInteger(userId) || !(await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first()))
    fail(401, 'Oturum gerekli')
  c.set('userId', userId)
  await next()
})

app.get('/me', async (c) => {
  const me = await c.env.DB.prepare('SELECT id, handle, email FROM users WHERE id = ?').bind(c.get('userId')).first()
  return c.json(me)
})

// Apple ile giren kullanıcı burada kullanıcı adını seçer.
app.put('/me', async (c) => {
  const { handle, displayName } = await readBody(c)
  if (typeof handle !== 'string' || !HANDLE_RE.test(handle)) fail(400, 'Kullanıcı adı 3-20 karakter: a-z, 0-9, _')
  if (!absent(displayName) && typeof displayName !== 'string') fail(400, 'displayName metin olmalı')
  try {
    await c.env.DB.prepare('UPDATE users SET handle = ?, display_name = ? WHERE id = ?')
      .bind(handle, (displayName as string | undefined) ?? null, c.get('userId')).run()
  } catch (e) {
    if (isUniqueViolation(e)) fail(409, 'Bu kullanıcı adı alınmış')
    throw e
  }
  return c.json({ ok: true })
})

// Hesap silme (App Store zorunluluğu). Yabancı anahtarlar ON DELETE CASCADE ile de siler; yine de her şey
// açıkça ve tek bir işlemde (batch) silinir, böylece FK uygulamasına bağlı kalınmaz.
app.delete('/me', async (c) => {
  const db = c.env.DB
  const me = c.get('userId')
  await db.batch([
    db.prepare('DELETE FROM list_items WHERE list_id IN (SELECT id FROM lists WHERE owner_id = ?)').bind(me),
    db.prepare('DELETE FROM lists WHERE owner_id = ?').bind(me),
    db.prepare('DELETE FROM ratings WHERE user_id = ?').bind(me),
    db.prepare('DELETE FROM comments WHERE user_id = ?').bind(me),
    db.prepare('DELETE FROM follows WHERE follower_id = ?1 OR followee_id = ?1').bind(me),
    db.prepare('DELETE FROM blocks WHERE blocker_id = ?1 OR blocked_id = ?1').bind(me),
    db.prepare('DELETE FROM reports WHERE reporter_id = ?').bind(me),
    db.prepare('DELETE FROM users WHERE id = ?').bind(me),
  ])
  return c.json({ ok: true })
})

// ---------- Listeler ----------
const VISIBILITIES = ['private', 'public']

app.get('/lists/mine', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.city, l.title, l.visibility, l.allow_copy AS allowCopy, l.allow_comments AS allowComments,
       (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS itemCount, l.updated_at AS updatedAt
     FROM lists l WHERE l.owner_id = ? ORDER BY l.updated_at DESC, l.id DESC`).bind(c.get('userId')).all<Json>()
  return c.json(results.map((r) => ({ ...r, allowCopy: bool(r.allowCopy), allowComments: bool(r.allowComments) })))
})

app.post('/lists', async (c) => {
  const b = await readBody(c)
  if (!isNonEmptyString(b.city) || b.city.length > 100) fail(400, 'city gerekli (en çok 100 karakter)')
  if (!isNonEmptyString(b.title) || b.title.length > 200) fail(400, 'title gerekli (en çok 200 karakter)')
  if (!absent(b.visibility) && !VISIBILITIES.includes(b.visibility as string)) fail(400, 'visibility: private | public')
  const t = now()
  const r = await c.env.DB.prepare(
    'INSERT INTO lists (owner_id, city, title, visibility, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .bind(c.get('userId'), b.city, b.title, (b.visibility as string | null | undefined) ?? 'private', t, t).run()
  return c.json({ id: r.meta.last_row_id }, 201)
})

async function requireOwnedList(c: C, id: number) {
  const row = await c.env.DB.prepare('SELECT 1 FROM lists WHERE id = ? AND owner_id = ?').bind(id, c.get('userId')).first()
  if (!row) fail(404, 'Liste bulunamadı')
}

app.patch('/lists/:id', async (c) => {
  const id = idParam(c)
  const b = await readBody(c)
  if (!absent(b.title) && (!isNonEmptyString(b.title) || b.title.length > 200)) fail(400, 'title en çok 200 karakter')
  if (!absent(b.visibility) && !VISIBILITIES.includes(b.visibility as string)) fail(400, 'visibility: private | public')
  if (!absent(b.allowCopy) && typeof b.allowCopy !== 'boolean') fail(400, 'allowCopy true/false olmalı')
  if (!absent(b.allowComments) && typeof b.allowComments !== 'boolean') fail(400, 'allowComments true/false olmalı')
  await requireOwnedList(c, id)
  await c.env.DB.prepare(
    `UPDATE lists SET title = COALESCE(?1, title), visibility = COALESCE(?2, visibility),
       allow_copy = COALESCE(?3, allow_copy), allow_comments = COALESCE(?4, allow_comments), updated_at = ?5
     WHERE id = ?6`)
    .bind(b.title ?? null, b.visibility ?? null,
      absent(b.allowCopy) ? null : Number(b.allowCopy), absent(b.allowComments) ? null : Number(b.allowComments),
      now(), id).run()
  return c.json({ ok: true })
})

app.delete('/lists/:id', async (c) => {
  const id = idParam(c)
  await requireOwnedList(c, id)
  const db = c.env.DB
  await db.batch([
    db.prepare('DELETE FROM list_items WHERE list_id = ?').bind(id),
    db.prepare('DELETE FROM lists WHERE id = ?').bind(id),
  ])
  return c.json({ ok: true })
})

const optional = (v: unknown, type: 'string' | 'number') =>
  absent(v) || (typeof v === type && (type !== 'number' || Number.isFinite(v)))

// Listenin tüm içeriğini tek seferde değiştirir (cihazdan senkron için). Tek işlemde, 4 sorguyla.
app.put('/lists/:id/items', async (c) => {
  const id = idParam(c)
  const b = await readBody(c)
  if (!Array.isArray(b.items)) return fail(400, 'items bir dizi olmalı')
  if (b.items.length > 500) fail(400, 'items en çok 500 öğe olabilir')
  for (const it of b.items as unknown[]) {
    const o = it as Json
    if (!o || typeof o !== 'object' || Array.isArray(o)) fail(400, 'items öğeleri nesne olmalı')
    if (!isNonEmptyString(o.provider) || !isNonEmptyString(o.providerId) || !isNonEmptyString(o.name))
      fail(400, 'provider, providerId ve name gerekli')
    if (!optional(o.lat, 'number') || !optional(o.lon, 'number')) fail(400, 'lat ve lon sayı olmalı')
    if (!optional(o.category, 'string') || !optional(o.city, 'string') || !optional(o.note, 'string'))
      fail(400, 'category, city ve note metin olmalı')
  }
  await requireOwnedList(c, id)

  // Aynı yer bir istekte iki kez gelirse ilki kalır.
  const seen = new Set<string>()
  const items = (b.items as Json[]).filter((it) => {
    const k = `${it.provider}\u0000${it.providerId}`
    return seen.has(k) ? false : (seen.add(k), true)
  }).map((it) => ({
    provider: it.provider, providerId: it.providerId, name: it.name,
    lat: it.lat ?? null, lon: it.lon ?? null,
    category: CATEGORIES.includes(it.category as string) ? it.category : 'other',
    city: it.city ?? null, note: ((it.note as string | undefined) ?? '').slice(0, 1000),
  }))
  const json = JSON.stringify(items)
  const db = c.env.DB
  await db.batch([
    db.prepare('DELETE FROM list_items WHERE list_id = ?').bind(id),
    db.prepare(
      `INSERT INTO places (provider, provider_id, name, lat, lon, category, city)
       SELECT json_extract(value, '$.provider'), json_extract(value, '$.providerId'), json_extract(value, '$.name'),
              json_extract(value, '$.lat'), json_extract(value, '$.lon'), json_extract(value, '$.category'),
              json_extract(value, '$.city')
       FROM json_each(?1) WHERE true
       ON CONFLICT (provider, provider_id) DO NOTHING`).bind(json),
    db.prepare(
      `INSERT INTO list_items (list_id, place_id, category, note, position)
       SELECT ?2, p.id, json_extract(j.value, '$.category'), json_extract(j.value, '$.note'), j.key
       FROM json_each(?1) j JOIN places p
         ON p.provider = json_extract(j.value, '$.provider') AND p.provider_id = json_extract(j.value, '$.providerId')`)
      .bind(json, id),
    db.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').bind(now(), id),
  ])
  return c.json({ ok: true, count: items.length })
})

// Liste detayı: özelse sadece sahibi görür. Sahibi engellediyse veya engellendiyse de gizli.
app.get('/lists/:id', async (c) => {
  const id = idParam(c)
  const list = await c.env.DB.prepare(
    `SELECT l.id, l.owner_id AS ownerId, u.handle AS ownerHandle, l.city, l.title, l.visibility,
       l.allow_copy AS allowCopy, l.allow_comments AS allowComments
     FROM lists l JOIN users u ON u.id = l.owner_id
     WHERE l.id = ?1 AND (l.owner_id = ?2 OR (l.visibility = 'public' AND NOT ${blockedBetween('l.owner_id', '?2')}))`)
    .bind(id, c.get('userId')).first<Json>()
  if (!list) return fail(404, 'Liste bulunamadı')
  const { results } = await c.env.DB.prepare(
    `SELECT p.id AS placeId, p.provider, p.provider_id AS providerId, p.name, p.lat, p.lon, i.category, i.note, i.position
     FROM list_items i JOIN places p ON p.id = i.place_id WHERE i.list_id = ? ORDER BY i.position`).bind(id).all()
  return c.json({ ...list, allowCopy: bool(list.allowCopy), allowComments: bool(list.allowComments), items: results })
})

// ---------- Keşfet ----------
app.get('/discover/lists', async (c) => {
  const city = c.req.query('city')?.trim() || null
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.city, l.title, u.handle AS ownerHandle,
       (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS itemCount,
       (SELECT ROUND(AVG(r.stars), 1) FROM list_items i JOIN ratings r ON r.place_id = i.place_id
         WHERE i.list_id = l.id) AS avgStars
     FROM lists l JOIN users u ON u.id = l.owner_id
     WHERE l.visibility = 'public' AND (?2 IS NULL OR l.city = ?2 COLLATE NOCASE)
       AND NOT ${blockedBetween('l.owner_id', '?1')}
     ORDER BY itemCount DESC, l.updated_at DESC, l.id DESC LIMIT 30`)
    .bind(c.get('userId'), city).all()
  return c.json(results)
})

// ---------- Puan ve yorum ----------
async function requirePlace(c: C, id: number) {
  if (!(await c.env.DB.prepare('SELECT 1 FROM places WHERE id = ?').bind(id).first())) fail(404, 'Yer bulunamadı')
}

app.get('/places/:id', async (c) => {
  const id = idParam(c)
  const db = c.env.DB
  const [place, stats, dist, mine] = await db.batch<Json>([
    db.prepare('SELECT id, name, lat, lon, category, city FROM places WHERE id = ?').bind(id),
    db.prepare('SELECT COUNT(*) AS count, ROUND(AVG(stars), 1) AS avg FROM ratings WHERE place_id = ?').bind(id),
    db.prepare('SELECT stars, COUNT(*) AS n FROM ratings WHERE place_id = ? GROUP BY stars').bind(id),
    db.prepare('SELECT stars FROM ratings WHERE place_id = ? AND user_id = ?').bind(id, c.get('userId')),
  ])
  if (!place.results.length) return fail(404, 'Yer bulunamadı')
  const s = stats.results[0]
  const distribution = [1, 2, 3, 4, 5].map((stars) => ({
    stars, n: (dist.results.find((d) => d.stars === stars)?.n as number | undefined) ?? 0,
  }))
  return c.json({
    place: place.results[0],
    rating: { count: s.count, avg: s.avg ?? null, distribution, mine: mine.results[0]?.stars ?? null },
  })
})

app.put('/places/:id/rating', async (c) => {
  const id = idParam(c)
  const { stars } = await readBody(c)
  if (!isInt(stars) || stars < 1 || stars > 5) fail(400, 'stars 1-5 arası tam sayı olmalı')
  await requirePlace(c, id)
  await c.env.DB.prepare(
    `INSERT INTO ratings (place_id, user_id, stars, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (place_id, user_id) DO UPDATE SET stars = excluded.stars, updated_at = excluded.updated_at`)
    .bind(id, c.get('userId'), stars, now()).run()
  return c.json({ ok: true })
})

// Yorum görünürlüğü: kendi yorumun her zaman görünür; başkasınınki public ise, ya da friends ve
// karşılıklı takip varsa görünür; private sadece yazanındır. Engel iki yönde de gizler.
app.get('/places/:id/comments', async (c) => {
  const id = idParam(c)
  await requirePlace(c, id)
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.parent_id AS parentId, c.body, c.visibility, c.created_at AS createdAt,
       c.user_id AS authorId, u.handle AS author
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.place_id = ?1 AND c.hidden = 0
       AND (c.user_id = ?2 OR (
         NOT ${blockedBetween('c.user_id', '?2')}
         AND (c.visibility = 'public' OR (c.visibility = 'friends' AND EXISTS (
           SELECT 1 FROM follows a JOIN follows f ON f.follower_id = a.followee_id AND f.followee_id = a.follower_id
           WHERE a.follower_id = ?2 AND a.followee_id = c.user_id)))))
     ORDER BY c.created_at DESC, c.id DESC LIMIT 100`).bind(id, c.get('userId')).all()
  return c.json(results)
})

const COMMENT_VISIBILITIES = ['private', 'friends', 'public']

app.post('/places/:id/comments', async (c) => {
  const id = idParam(c)
  const b = await readBody(c)
  const body = typeof b.body === 'string' ? b.body.trim() : null
  if (body === null || body.length < 1 || body.length > 1000) fail(400, 'Yorum 1-1000 karakter olmalı')
  if (!absent(b.visibility) && !COMMENT_VISIBILITIES.includes(b.visibility as string))
    fail(400, 'visibility: private | friends | public')
  if (!absent(b.parentId) && !isInt(b.parentId)) fail(400, 'parentId tam sayı olmalı')
  const me = c.get('userId')
  const db = c.env.DB
  // Basit hız sınırı: dakikada en fazla 5 yorum.
  const cutoff = new Date(Date.now() - 60_000).toISOString()
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > ?')
    .bind(me, cutoff).first<{ n: number }>()
  if ((recent?.n ?? 0) >= 5) fail(429, 'Çok hızlısın, biraz bekle')
  await requirePlace(c, id)
  const parentId = absent(b.parentId) ? null : (b.parentId as number)
  if (parentId !== null &&
    !(await db.prepare('SELECT 1 FROM comments WHERE id = ? AND place_id = ?').bind(parentId, id).first()))
    fail(400, 'parentId geçersiz')
  const r = await db.prepare(
    'INSERT INTO comments (place_id, user_id, parent_id, body, visibility, created_at) VALUES (?,?,?,?,?,?)')
    .bind(id, me, parentId, body, (b.visibility as string | null | undefined) ?? 'public', now()).run()
  return c.json({ id: r.meta.last_row_id }, 201)
})

app.delete('/comments/:id', async (c) => {
  const id = idParam(c)
  const r = await c.env.DB.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?').bind(id, c.get('userId')).run()
  if (!r.meta.changes) fail(404, 'Yorum bulunamadı')
  return c.json({ ok: true })
})

// ---------- Takip ve arkadaşlar ----------
// Arkadaş = karşılıklı takip.
app.get('/users/search', async (c) => {
  const prefix = (c.req.query('q') ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (prefix.length < 2) return c.json([])
  const me = c.get('userId')
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.handle,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ?1 AND f.followee_id = u.id) AS following,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = ?1) AS followsMe
     FROM users u WHERE u.handle LIKE ?2 ESCAPE '\\' AND u.id != ?1 AND NOT ${blockedBetween('?1', 'u.id')}
     ORDER BY u.handle LIMIT 20`).bind(me, prefix.replace(/_/g, '\\_') + '%').all<Json>()
  return c.json(results.map((r) => ({ id: r.id, handle: r.handle, following: bool(r.following), followsMe: bool(r.followsMe) })))
})

app.get('/following', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.handle,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = ?1) AS followsMe
     FROM follows o JOIN users u ON u.id = o.followee_id WHERE o.follower_id = ?1 ORDER BY u.handle`)
    .bind(c.get('userId')).all<Json>()
  return c.json(results.map((r) => ({ id: r.id, handle: r.handle, following: true, followsMe: bool(r.followsMe) })))
})

app.post('/follows/:userId', async (c) => {
  const target = idParam(c, 'userId')
  const me = c.get('userId')
  if (target === me) fail(400, 'Kendini takip edemezsin')
  const r = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at)
     SELECT ?1, u.id, ?3 FROM users u WHERE u.id = ?2 AND NOT ${blockedBetween('?1', 'u.id')}`)
    .bind(me, target, now()).run()
  if (!r.meta.changes) {
    // Zaten takip ediliyorsa da değişiklik olmaz; o durumda başarı dön.
    const exists = await c.env.DB.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
      .bind(me, target).first()
    if (!exists) fail(404, 'Kullanıcı bulunamadı')
  }
  return c.json({ ok: true })
})

app.delete('/follows/:userId', async (c) => {
  const target = idParam(c, 'userId')
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').bind(c.get('userId'), target).run()
  return c.json({ ok: true })
})

// ---------- Yer arama ----------
// Sağlayıcı (Google Places / Photon / fake) ve eşleme src/search-core.ts'te; dosya server/src/search ile birebir aynı.
// Anahtar yalnızca sunucuda kalır; sağlayıcı hatası ya da 5 sn zaman aşımı 502 döner.
app.get('/search/places', async (c) => {
  try {
    const query = parseSearchQuery(c.req.query('q'), c.req.query('lat'), c.req.query('lon'))
    const env = { SEARCH_PROVIDER: c.env.SEARCH_PROVIDER, GOOGLE_PLACES_API_KEY: c.env.GOOGLE_PLACES_API_KEY }
    return c.json(await searchPlaces(env, query, (url, init) => fetch(url, init)))
  } catch (e) {
    if (e instanceof SearchError) return fail(e.status, e.message)
    throw e
  }
})

// ---------- Güvenlik: şikayet ve engel ----------
app.post('/reports', async (c) => {
  const b = await readBody(c)
  if (!['comment', 'list', 'user'].includes(b.targetType as string)) fail(400, 'targetType: comment | list | user')
  if (!isInt(b.targetId)) fail(400, 'targetId tam sayı olmalı')
  if (!isNonEmptyString(b.reason)) fail(400, 'reason gerekli')
  const db = c.env.DB
  const stmts = [
    db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?)')
      .bind(c.get('userId'), b.targetType, b.targetId, (b.reason as string).slice(0, 500), now()),
  ]
  // Aynı yorum 3 farklı kişi tarafından şikayet edilirse otomatik gizlenir; inceleme sonrası geri açılır.
  if (b.targetType === 'comment') {
    stmts.push(db.prepare(
      `UPDATE comments SET hidden = 1 WHERE id = ?1 AND
       (SELECT COUNT(DISTINCT reporter_id) FROM reports WHERE target_type = 'comment' AND target_id = ?1) >= 3`)
      .bind(b.targetId))
  }
  await db.batch(stmts)
  return c.json({ ok: true }, 201)
})

app.post('/blocks/:userId', async (c) => {
  const target = idParam(c, 'userId')
  const me = c.get('userId')
  if (target === me) fail(400, 'Kendini engelleyemezsin')
  const db = c.env.DB
  if (!(await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(target).first())) fail(404, 'Kullanıcı bulunamadı')
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?,?)').bind(me, target),
    db.prepare(`DELETE FROM follows WHERE (follower_id = ?1 AND followee_id = ?2)
                                       OR (follower_id = ?2 AND followee_id = ?1)`).bind(me, target),
  ])
  return c.json({ ok: true })
})

app.delete('/blocks/:userId', async (c) => {
  const target = idParam(c, 'userId')
  await c.env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(c.get('userId'), target).run()
  return c.json({ ok: true })
})

export default app
