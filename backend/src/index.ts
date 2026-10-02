import { Hono } from 'hono'
import { sign, verify } from 'hono/jwt'
import { createRemoteJWKSet, jwtVerify } from 'jose'

type Env = { DB: D1Database; SESSION_SECRET: string; APPLE_BUNDLE_ID: string }
type Vars = { userId: number }
const app = new Hono<{ Bindings: Env; Variables: Vars }>()

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
const CATEGORIES = ['food', 'coffee', 'bar', 'historic', 'museum', 'park', 'beach', 'hotel', 'airport', 'other']
const SESSION_DAYS = 30

const bad = (c: any, msg: string, status: 400 | 403 | 404 = 400) => c.json({ error: msg }, status)

// ---------- Kimlik ----------
// iOS, Apple ile girişten aldığı identityToken'ı gönderir; biz oturum jetonu döneriz.
app.post('/auth/apple', async (c) => {
  const { identityToken } = await c.req.json<{ identityToken?: string }>().catch(() => ({} as any))
  if (!identityToken) return bad(c, 'identityToken gerekli')
  let sub: string
  try {
    const { payload } = await jwtVerify(identityToken, appleKeys, {
      issuer: 'https://appleid.apple.com',
      audience: c.env.APPLE_BUNDLE_ID,
    })
    sub = String(payload.sub)
  } catch {
    return bad(c, 'Apple jetonu geçersiz', 403)
  }
  await c.env.DB.prepare('INSERT OR IGNORE INTO users (apple_sub) VALUES (?)').bind(sub).run()
  const user = await c.env.DB.prepare('SELECT id, handle, display_name FROM users WHERE apple_sub = ?')
    .bind(sub).first<{ id: number; handle: string | null; display_name: string | null }>()
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400
  const token = await sign({ sub: String(user!.id), exp }, c.env.SESSION_SECRET)
  return c.json({ token, user })
})

// Bundan sonrakiler oturum ister. Herkese açık okuma uçları da kullanıcıyı tanır (engel listesi için).
app.use('/*', async (c, next) => {
  if (c.req.path === '/auth/apple') return next()
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  try {
    const payload = await verify(token, c.env.SESSION_SECRET, 'HS256')
    c.set('userId', Number(payload.sub))
  } catch {
    return c.json({ error: 'Oturum gerekli' }, 401)
  }
  await next()
})

app.get('/me', async (c) => {
  const me = await c.env.DB.prepare('SELECT id, handle, display_name FROM users WHERE id = ?')
    .bind(c.get('userId')).first()
  return c.json(me)
})

app.put('/me', async (c) => {
  const { handle, displayName } = await c.req.json<{ handle?: string; displayName?: string }>()
  if (!handle || !/^[a-z0-9_]{3,20}$/.test(handle)) return bad(c, 'Kullanıcı adı 3-20 karakter: a-z, 0-9, _')
  try {
    await c.env.DB.prepare('UPDATE users SET handle = ?, display_name = ? WHERE id = ?')
      .bind(handle, displayName ?? null, c.get('userId')).run()
  } catch {
    return bad(c, 'Bu kullanıcı adı alınmış')
  }
  return c.json({ ok: true })
})

// Hesap silme (App Store zorunluluğu): bağlı her şey ON DELETE CASCADE ile gider.
app.delete('/me', async (c) => {
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(c.get('userId')).run()
  return c.json({ ok: true })
})

// ---------- Listeler ----------
app.get('/lists/mine', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS item_count
     FROM lists l WHERE owner_id = ? ORDER BY updated_at DESC`).bind(c.get('userId')).all()
  return c.json(rows.results)
})

app.post('/lists', async (c) => {
  const b = await c.req.json<{ city?: string; title?: string; visibility?: string }>()
  if (!b.city || !b.title) return bad(c, 'city ve title gerekli')
  const visibility = b.visibility === 'public' ? 'public' : 'private'
  const r = await c.env.DB.prepare('INSERT INTO lists (owner_id, city, title, visibility) VALUES (?,?,?,?)')
    .bind(c.get('userId'), b.city, b.title, visibility).run()
  return c.json({ id: r.meta.last_row_id }, 201)
})

async function ownedList(c: any, id: number) {
  return c.env.DB.prepare('SELECT * FROM lists WHERE id = ? AND owner_id = ?').bind(id, c.get('userId')).first()
}

app.patch('/lists/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await ownedList(c, id))) return bad(c, 'Liste bulunamadı', 404)
  const b = await c.req.json<{ title?: string; visibility?: string; allowCopy?: boolean; allowComments?: boolean }>()
  await c.env.DB.prepare(
    `UPDATE lists SET title = COALESCE(?, title), visibility = COALESCE(?, visibility),
       allow_copy = COALESCE(?, allow_copy), allow_comments = COALESCE(?, allow_comments),
       updated_at = datetime('now') WHERE id = ?`)
    .bind(b.title ?? null,
      b.visibility === 'public' || b.visibility === 'private' ? b.visibility : null,
      b.allowCopy === undefined ? null : Number(b.allowCopy),
      b.allowComments === undefined ? null : Number(b.allowComments), id).run()
  return c.json({ ok: true })
})

app.delete('/lists/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await ownedList(c, id))) return bad(c, 'Liste bulunamadı', 404)
  await c.env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// Listenin tüm içeriğini tek seferde değiştirir (cihazdan senkron için).
app.put('/lists/:id/items', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await ownedList(c, id))) return bad(c, 'Liste bulunamadı', 404)
  const { items } = await c.req.json<{ items: Array<{
    provider: string; providerId: string; name: string; lat?: number; lon?: number
    category?: string; city?: string; note?: string }> }>()
  if (!Array.isArray(items) || items.length > 500) return bad(c, 'items 0-500 arası olmalı')
  const db = c.env.DB
  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM list_items WHERE list_id = ?').bind(id)]
  items.forEach((it, pos) => {
    const cat = CATEGORIES.includes(it.category ?? '') ? it.category! : 'other'
    stmts.push(
      db.prepare(`INSERT INTO places (provider, provider_id, name, lat, lon, category, city)
                  VALUES (?,?,?,?,?,?,?) ON CONFLICT (provider, provider_id) DO NOTHING`)
        .bind(it.provider, it.providerId, it.name, it.lat ?? null, it.lon ?? null, cat, it.city ?? null),
      db.prepare(`INSERT INTO list_items (list_id, place_id, category, note, position)
                  SELECT ?, id, ?, ?, ? FROM places WHERE provider = ? AND provider_id = ?`)
        .bind(id, cat, (it.note ?? '').slice(0, 1000), pos, it.provider, it.providerId))
  })
  stmts.push(db.prepare("UPDATE lists SET updated_at = datetime('now') WHERE id = ?").bind(id))
  await db.batch(stmts)
  return c.json({ ok: true, count: items.length })
})

// Liste detayı: özelse sadece sahibi görür. Sahibi engellediyse veya engellendiyse de gizli.
app.get('/lists/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const me = c.get('userId')
  const list = await c.env.DB.prepare(
    `SELECT l.*, u.handle AS owner_handle FROM lists l JOIN users u ON u.id = l.owner_id
     WHERE l.id = ? AND (l.owner_id = ? OR (l.visibility = 'public' AND NOT EXISTS (
       SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = l.owner_id)
                                  OR (b.blocker_id = l.owner_id AND b.blocked_id = ?))))`)
    .bind(id, me, me, me).first<{ owner_id: number }>()
  if (!list) return bad(c, 'Liste bulunamadı', 404)
  const items = await c.env.DB.prepare(
    `SELECT p.id AS place_id, p.name, p.lat, p.lon, i.category, i.note, i.position
     FROM list_items i JOIN places p ON p.id = i.place_id WHERE i.list_id = ? ORDER BY i.position`).bind(id).all()
  return c.json({ ...list, items: items.results })
})

// ---------- Keşfet ----------
app.get('/discover/lists', async (c) => {
  const city = c.req.query('city')
  const me = c.get('userId')
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.city, l.title, u.handle AS owner_handle,
       (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS item_count,
       (SELECT ROUND(AVG(r.stars), 1) FROM list_items i JOIN ratings r ON r.place_id = i.place_id
         WHERE i.list_id = l.id) AS avg_stars
     FROM lists l JOIN users u ON u.id = l.owner_id
     WHERE l.visibility = 'public' AND (? IS NULL OR l.city = ?)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = l.owner_id)
                                                OR (b.blocker_id = l.owner_id AND b.blocked_id = ?))
     ORDER BY item_count DESC, l.updated_at DESC LIMIT 30`)
    .bind(city ?? null, city ?? null, me, me).all()
  return c.json(rows.results)
})

// ---------- Puan ve yorum ----------
app.get('/places/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const place = await c.env.DB.prepare('SELECT * FROM places WHERE id = ?').bind(id).first()
  if (!place) return bad(c, 'Yer bulunamadı', 404)
  const stats = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count, ROUND(AVG(stars), 1) AS avg FROM ratings WHERE place_id = ?').bind(id).first()
  const dist = await c.env.DB.prepare(
    'SELECT stars, COUNT(*) AS n FROM ratings WHERE place_id = ? GROUP BY stars').bind(id).all()
  const mine = await c.env.DB.prepare('SELECT stars FROM ratings WHERE place_id = ? AND user_id = ?')
    .bind(id, c.get('userId')).first<{ stars: number }>()
  return c.json({ place, rating: { ...stats, distribution: dist.results, mine: mine?.stars ?? null } })
})

app.put('/places/:id/rating', async (c) => {
  const id = Number(c.req.param('id'))
  const { stars } = await c.req.json<{ stars?: number }>()
  if (!Number.isInteger(stars) || stars! < 1 || stars! > 5) return bad(c, 'stars 1-5 arası tam sayı olmalı')
  const r = await c.env.DB.prepare(
    `INSERT INTO ratings (place_id, user_id, stars) SELECT id, ?, ? FROM places WHERE id = ?
     ON CONFLICT (place_id, user_id) DO UPDATE SET stars = excluded.stars, updated_at = datetime('now')`)
    .bind(c.get('userId'), stars, id).run()
  if (!r.meta.changes) return bad(c, 'Yer bulunamadı', 404)
  return c.json({ ok: true })
})

app.get('/places/:id/comments', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.parent_id, c.body, c.created_at, u.handle AS author
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.place_id = ? AND c.hidden = 0
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ? AND b.blocked_id = c.user_id)
     ORDER BY c.created_at DESC LIMIT 100`).bind(c.req.param('id'), c.get('userId')).all()
  return c.json(rows.results)
})

app.post('/places/:id/comments', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{ body?: string; parentId?: number }>()
  const body = (b.body ?? '').trim()
  if (!body || body.length > 1000) return bad(c, 'Yorum 1-1000 karakter olmalı')
  const me = c.get('userId')
  // Basit hız sınırı: dakikada en fazla 5 yorum.
  const recent = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > datetime('now','-1 minute')")
    .bind(me).first<{ n: number }>()
  if ((recent?.n ?? 0) >= 5) return c.json({ error: 'Çok hızlısın, biraz bekle' }, 429)
  const r = await c.env.DB.prepare(
    'INSERT INTO comments (place_id, user_id, parent_id, body) SELECT id, ?, ?, ? FROM places WHERE id = ?')
    .bind(me, b.parentId ?? null, body, id).run()
  if (!r.meta.changes) return bad(c, 'Yer bulunamadı', 404)
  return c.json({ id: r.meta.last_row_id }, 201)
})

app.delete('/comments/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId')).run()
  return c.json({ ok: true })
})

// ---------- Güvenlik: şikayet ve engel ----------
app.post('/reports', async (c) => {
  const b = await c.req.json<{ targetType?: string; targetId?: number; reason?: string }>()
  if (!['comment', 'list', 'user'].includes(b.targetType ?? '') || !b.targetId || !b.reason)
    return bad(c, 'targetType, targetId ve reason gerekli')
  await c.env.DB.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?,?,?,?)')
    .bind(c.get('userId'), b.targetType, b.targetId, b.reason.slice(0, 500)).run()
  // Aynı yorum 3 farklı kişi tarafından şikayet edilirse otomatik gizlenir; inceleme sonrası geri açılır.
  if (b.targetType === 'comment') {
    await c.env.DB.prepare(
      `UPDATE comments SET hidden = 1 WHERE id = ? AND
       (SELECT COUNT(DISTINCT reporter_id) FROM reports WHERE target_type = 'comment' AND target_id = ?) >= 3`)
      .bind(b.targetId, b.targetId).run()
  }
  return c.json({ ok: true }, 201)
})

app.post('/blocks/:userId', async (c) => {
  const target = Number(c.req.param('userId'))
  if (target === c.get('userId')) return bad(c, 'Kendini engelleyemezsin')
  await c.env.DB.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?,?)')
    .bind(c.get('userId'), target).run()
  return c.json({ ok: true })
})

app.delete('/blocks/:userId', async (c) => {
  await c.env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
    .bind(c.get('userId'), c.req.param('userId')).run()
  return c.json({ ok: true })
})

export default app
