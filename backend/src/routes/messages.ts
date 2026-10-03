// Mesajlaşma (docs/ACCEPTANCE.md, MSG): /conversations uçları. src/index.ts bunu oturum ara katmanından SONRA
// `app.route('/conversations', messages)` ile bağlar; bu yüzden burada c.get('userId') her zaman doludur.
// Kurallar ve SQL src/messages-core.ts'te (server/src/messages ile birebir aynı). Gerçek zaman yok: istemci yoklar.
import { Hono, type Context } from 'hono'
import {
  ADD_MEMBERS_SQL, CONVERSATION_BY_PAIR_SQL, CONVERSATIONS_SQL, CREATE_CONVERSATION_SQL, decideOpen, INSERT_MESSAGE_SQL,
  LIST_VIEW_SQL, MARK_READ_SQL, MEMBER_SQL, MessageError, MESSAGE_BY_ID_SQL, MESSAGES_AFTER_SQL, MESSAGES_LATEST_SQL,
  OPEN_FACTS_SQL, PLACE_EXISTS_SQL, pairKey, parseConversationHandle, parseMessageInput, parseMessagesQuery, rateCutoff,
  RECENT_SENT_SQL, requireAttachable, requireCanSend, requireMember, requireRate, toConversation, toMessage, UNREAD_SQL,
  type ListViewRow, type MemberRow,
} from '../messages-core'

type Env = { Bindings: { DB: D1Database }; Variables: { userId: number } }
type C = Context<Env>
type Row = Record<string, unknown>

const messages = new Hono<Env>()

messages.onError((err, c) => {
  if (err instanceof MessageError) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

const fail = (status: 400 | 404, message: string): never => { throw new MessageError(status, message) }

async function readBody(c: C): Promise<Row> {
  const text = await c.req.text()
  if (!text.trim()) return {}
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return fail(400, 'Geçersiz JSON') }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Row) : {}
}

/** Sayısal olmayan kimlik 404 (index.ts idParam ve NestJS ParseIntPipe ile aynı). */
function idParam(c: C): number {
  const raw = c.req.param('id') ?? ''
  if (!/^\d+$/.test(raw)) fail(404, 'Sohbet bulunamadı')
  return Number(raw)
}

async function membership(c: C, id: number) {
  return requireMember(await c.env.DB.prepare(MEMBER_SQL).bind(id, c.get('userId')).first<MemberRow>())
}

messages.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(CONVERSATIONS_SQL).bind(c.get('userId')).all<Row>()
  return c.json(results.map(toConversation))
})

messages.get('/unread', async (c) => {
  const r = await c.env.DB.prepare(UNREAD_SQL).bind(c.get('userId')).first<{ count: number }>()
  return c.json({ count: Number(r?.count ?? 0) })
})

// İki kişi arasında tek sohbet: varsa 200 ile aynısı, yoksa 201 ile yenisi.
messages.post('/', async (c) => {
  const me = c.get('userId')
  const handle = parseConversationHandle((await readBody(c)).handle)
  const db = c.env.DB
  const target = await db.prepare('SELECT id FROM users WHERE handle = ?').bind(handle).first<{ id: number }>()
  const targetId = target ? Number(target.id) : null
  const key = pairKey(me, targetId ?? 0)
  const facts = await db.prepare(OPEN_FACTS_SQL).bind(me, targetId ?? 0, key).first<Row>()
  const existingId = facts?.existingId === null || facts?.existingId === undefined ? null : Number(facts.existingId)
  const outcome = decideOpen({
    targetId, me, blocked: facts?.blocked === 1, mutual: facts?.mutual === 1, existingId,
  })
  if (outcome === 'existing') return c.json({ id: existingId }, 200)
  const [, , row] = await db.batch<{ id: number }>([
    db.prepare(CREATE_CONVERSATION_SQL).bind(key, new Date().toISOString()),
    db.prepare(ADD_MEMBERS_SQL).bind(key, me, targetId),
    db.prepare(CONVERSATION_BY_PAIR_SQL).bind(key),
  ])
  return c.json({ id: Number(row.results[0].id) }, 201)
})

// Sohbet başlığı için: karşı taraf ve gönderilebilir mi (engel ya da arkadaşlık bitmişse false).
messages.get('/:id', async (c) => {
  const id = idParam(c)
  const m = await membership(c, id)
  return c.json({ id, other: m.other, canSend: m.canSend })
})

messages.get('/:id/messages', async (c) => {
  const id = idParam(c)
  await membership(c, id)
  const { after, limit } = parseMessagesQuery(c.req.query('after'), c.req.query('limit'))
  const me = c.get('userId')
  const stmt = after === null
    ? c.env.DB.prepare(MESSAGES_LATEST_SQL).bind(id, me, limit)
    : c.env.DB.prepare(MESSAGES_AFTER_SQL).bind(id, me, after, limit)
  const { results } = await stmt.all<Row>()
  const rows = after === null ? results.reverse() : results
  return c.json(rows.map((r) => toMessage(r, me)))
})

messages.post('/:id/messages', async (c) => {
  const id = idParam(c)
  const m = await membership(c, id)
  const b = await readBody(c)
  const input = parseMessageInput(b.body, b.attachment)
  requireCanSend(m)
  const me = c.get('userId')
  const db = c.env.DB
  const at = new Date()
  const recent = await db.prepare(RECENT_SENT_SQL).bind(me, rateCutoff(at)).first<{ n: number }>()
  requireRate(Number(recent?.n ?? 0))
  if (input.attachment) {
    const { type, id: targetId } = input.attachment
    const placeExists = type === 'place' && !!(await db.prepare(PLACE_EXISTS_SQL).bind(targetId).first())
    const list = type === 'list' ? await db.prepare(LIST_VIEW_SQL).bind(targetId, me).first<ListViewRow>() : null
    requireAttachable(type, placeExists, list, me)
  }
  const inserted = await db.prepare(INSERT_MESSAGE_SQL)
    .bind(id, me, input.body, input.attachment?.type ?? null, input.attachment?.id ?? null, at.toISOString())
    .first<{ id: number }>()
  const row = await db.prepare(MESSAGE_BY_ID_SQL).bind(id, me, inserted!.id).first<Row>()
  return c.json(toMessage(row!, me), 201)
})

messages.post('/:id/read', async (c) => {
  const id = idParam(c)
  await membership(c, id)
  await c.env.DB.prepare(MARK_READ_SQL).bind(id, c.get('userId'), new Date().toISOString()).run()
  return c.json({ ok: true })
})

export default messages
