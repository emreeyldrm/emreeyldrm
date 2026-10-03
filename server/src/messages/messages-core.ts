// Messaging between friends (docs/ACCEPTANCE.md, "Mesajlaşma (MSG)").
//
// THIS FILE IS SHARED VERBATIM between server/src/messages/messages-core.ts (NestJS) and
// backend/src/messages-core.ts (Cloudflare Worker). Edit one, then copy it over the other:
//   cp server/src/messages/messages-core.ts backend/src/messages-core.ts
// server/test/unit/messages-core.spec.ts fails if the two copies differ.
//
// Both servers use SQLite (better-sqlite3 / D1), so the SQL lives here too. Pure values and functions only:
// no framework, database or runtime dependencies.

export const MAX_BODY = 2000
/** At most this many messages per sender in RATE_WINDOW_MS (429 afterwards). */
export const RATE_LIMIT = 30
export const RATE_WINDOW_MS = 60_000
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100
/** Title of a list attachment the viewer may not open (no title, city or size leaks). */
export const PRIVATE_LIST_TITLE = 'Özel liste'
export const MISSING_PLACE_TITLE = 'Yer bulunamadı'

export type AttachmentType = 'place' | 'list'
export const ATTACHMENT_TYPES: readonly AttachmentType[] = ['place', 'list']

/** Error with an HTTP status; both servers map it to `{error}` with that status. */
export class MessageError extends Error {
  constructor(public status: 400 | 403 | 404 | 429, message: string) { super(message) }
}

const NOT_FOUND = 'Sohbet bulunamadı'
const truthy = (v: unknown) => v === 1 || v === true || v === '1'

/** One conversation per pair of users: "<smaller id>:<larger id>" (conversations.pair_key, UNIQUE). */
export const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`)

// ---------- Input ----------
/** `handle` of POST /conversations. */
export function parseConversationHandle(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new MessageError(400, 'handle gerekli')
  return v.trim().toLowerCase()
}

export interface MessageInput {
  body: string
  attachment: { type: AttachmentType; id: number } | null
}

/** Body of POST /conversations/:id/messages: text 1–2000 characters (trimmed) or an attachment, or both. */
export function parseMessageInput(body: unknown, attachment: unknown): MessageInput {
  if (body !== undefined && body !== null && typeof body !== 'string') throw new MessageError(400, 'body metin olmalı')
  const text = typeof body === 'string' ? body.trim() : ''
  if (text.length > MAX_BODY) throw new MessageError(400, `Mesaj en çok ${MAX_BODY} karakter olabilir`)
  let att: MessageInput['attachment'] = null
  if (attachment !== undefined && attachment !== null) {
    const a = attachment as { type?: unknown; id?: unknown }
    if (typeof attachment !== 'object' || Array.isArray(attachment)) throw new MessageError(400, 'attachment nesne olmalı')
    if (!ATTACHMENT_TYPES.includes(a.type as AttachmentType)) throw new MessageError(400, 'attachment.type: place | list')
    if (typeof a.id !== 'number' || !Number.isInteger(a.id) || a.id < 1) throw new MessageError(400, 'attachment.id tam sayı olmalı')
    att = { type: a.type as AttachmentType, id: a.id }
  }
  if (!text && !att) throw new MessageError(400, 'Mesaj boş olamaz')
  return { body: text, attachment: att }
}

/** `?after=<message id>&limit=` of GET /conversations/:id/messages; invalid values 400. */
export function parseMessagesQuery(after: unknown, limit: unknown): { after: number | null; limit: number } {
  const int = (v: unknown, name: string, min: number, max: number): number | null => {
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new MessageError(400, `${name} tam sayı olmalı`)
    const n = Number(v)
    if (n < min || n > max) throw new MessageError(400, `${name} ${min}-${max} arası olmalı`)
    return n
  }
  return { after: int(after, 'after', 0, Number.MAX_SAFE_INTEGER), limit: int(limit, 'limit', 1, MAX_LIMIT) ?? DEFAULT_LIMIT }
}

// ---------- Decisions ----------
export interface OpenFacts {
  /** Target user id (null when the handle does not exist). */
  targetId: number | null
  me: number
  /** Block in either direction. */
  blocked: boolean
  /** Follow each other (friends). */
  mutual: boolean
  /** Id of the pair's existing conversation, if any. */
  existingId: number | null
}

/**
 * POST /conversations {handle}: 'existing' (200, same conversation) or 'create' (201), else an error:
 * unknown handle 404, yourself 400, block 403, not friends 403.
 */
export function decideOpen(f: OpenFacts): 'existing' | 'create' {
  if (f.targetId === null) throw new MessageError(404, 'Kullanıcı bulunamadı')
  if (f.targetId === f.me) throw new MessageError(400, 'Kendinle sohbet açamazsın')
  if (f.blocked) throw new MessageError(403, 'Bu kullanıcıyla mesajlaşamazsın')
  if (f.existingId !== null) return 'existing'
  if (!f.mutual) throw new MessageError(403, 'Yalnızca arkadaşlarınla (karşılıklı takip) mesajlaşabilirsin')
  return 'create'
}

/** Row of MEMBER_SQL: null when the requester is not a member (or the conversation does not exist). */
export interface MemberRow { otherId: unknown; otherHandle: unknown; blocked: unknown; mutual: unknown }

export interface Membership { other: { id: number; handle: string | null }; canSend: boolean; blocked: boolean; mutual: boolean }

/** Every conversation endpoint: non-members (and missing conversations) get 404. */
export function requireMember(row: MemberRow | null | undefined): Membership {
  if (!row) throw new MessageError(404, NOT_FOUND)
  const blocked = truthy(row.blocked)
  const mutual = truthy(row.mutual)
  return {
    other: { id: Number(row.otherId), handle: (row.otherHandle as string | null) ?? null },
    canSend: !blocked && mutual, blocked, mutual,
  }
}

/** Sending: a block (either direction) 403; no longer friends 403. Reading the conversation stays allowed. */
export function requireCanSend(m: Membership): void {
  if (m.blocked) throw new MessageError(403, 'Bu kullanıcıyla mesajlaşamazsın')
  if (!m.mutual) throw new MessageError(403, 'Yalnızca arkadaşlarınla (karşılıklı takip) mesajlaşabilirsin')
}

/** 429 when the sender already sent RATE_LIMIT messages in the last minute. */
export function requireRate(recentCount: number): void {
  if (recentCount >= RATE_LIMIT) throw new MessageError(429, 'Çok hızlısın, biraz bekle')
}

/** Start of the rate-limit window (messages.created_at is compared with it). */
export const rateCutoff = (now: Date): string => new Date(now.getTime() - RATE_WINDOW_MS).toISOString()

/** Row of LIST_VIEW_SQL (list ?1, viewer ?2); no row = the list does not exist. */
export interface ListViewRow { ownerId: unknown; visibility: unknown; isMember: unknown; blocked: unknown }

/** The same rule as GET /lists/:id (collab-core listAccess): owner, editor, or a public list without a block. */
export function canViewList(row: ListViewRow | null | undefined, viewer: number): boolean {
  if (!row) return false
  if (Number(row.ownerId) === viewer || truthy(row.isMember)) return true
  return row.visibility === 'public' && !truthy(row.blocked)
}

/** Attaching: a place must exist; a list must be one the sender can open. Otherwise 400. */
export function requireAttachable(type: AttachmentType, placeExists: boolean, list: ListViewRow | null | undefined, sender: number): void {
  if (type === 'place' && !placeExists) throw new MessageError(400, 'Eklenen yer bulunamadı')
  if (type === 'list' && !canViewList(list, sender)) throw new MessageError(400, 'Eklenen liste bulunamadı')
}

// ---------- SQL (both servers; ?N placeholders) ----------
/** Facts for POST /conversations: ?1 me, ?2 target id (0 when unknown), ?3 pair key. */
export const OPEN_FACTS_SQL = `SELECT
     EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = ?1 AND bk.blocked_id = ?2)
                                        OR (bk.blocker_id = ?2 AND bk.blocked_id = ?1)) AS blocked,
     EXISTS (SELECT 1 FROM follows a JOIN follows b ON b.follower_id = a.followee_id AND b.followee_id = a.follower_id
             WHERE a.follower_id = ?1 AND a.followee_id = ?2) AS mutual,
     (SELECT id FROM conversations WHERE pair_key = ?3) AS existingId`

/** Creates the pair's conversation (no-op if it exists): ?1 pair key, ?2 created_at. */
export const CREATE_CONVERSATION_SQL =
  `INSERT INTO conversations (pair_key, created_at) VALUES (?1, ?2) ON CONFLICT (pair_key) DO NOTHING`
/** Adds both users to the pair's conversation: ?1 pair key, ?2 and ?3 user ids. */
export const ADD_MEMBERS_SQL = `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, last_read_at, last_read_id)
   SELECT c.id, u.id, NULL, 0 FROM conversations c, users u WHERE c.pair_key = ?1 AND u.id IN (?2, ?3)`
export const CONVERSATION_BY_PAIR_SQL = `SELECT id FROM conversations WHERE pair_key = ?1`

/** Membership of ?2 in conversation ?1 with the other member and the send facts; no row = 404. */
export const MEMBER_SQL = `SELECT o.user_id AS otherId, u.handle AS otherHandle,
     EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = ?2 AND bk.blocked_id = o.user_id)
                                        OR (bk.blocker_id = o.user_id AND bk.blocked_id = ?2)) AS blocked,
     EXISTS (SELECT 1 FROM follows a JOIN follows b ON b.follower_id = a.followee_id AND b.followee_id = a.follower_id
             WHERE a.follower_id = ?2 AND a.followee_id = o.user_id) AS mutual
   FROM conversation_members me
   JOIN conversation_members o ON o.conversation_id = me.conversation_id AND o.user_id != me.user_id
   JOIN users u ON u.id = o.user_id
   WHERE me.conversation_id = ?1 AND me.user_id = ?2`

/** GET /conversations for ?1: the other member, last message and unread count, newest activity first. */
export const CONVERSATIONS_SQL = `SELECT c.id, o.user_id AS otherId, u.handle AS otherHandle,
     lm.id AS lastId, lm.body AS lastBody, lm.attachment_type AS lastAttachmentType, lm.created_at AS lastCreatedAt,
     lm.sender_id AS lastSenderId,
     (SELECT COUNT(*) FROM messages x WHERE x.conversation_id = c.id AND x.sender_id != ?1 AND x.id > me.last_read_id) AS unread
   FROM conversation_members me
   JOIN conversations c ON c.id = me.conversation_id
   JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id != ?1
   JOIN users u ON u.id = o.user_id
   LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
   WHERE me.user_id = ?1
   ORDER BY COALESCE(lm.created_at, c.created_at) DESC, COALESCE(lm.id, 0) DESC, c.id DESC`

/** GET /conversations/unread for ?1: messages from others after the reader's last read message. */
export const UNREAD_SQL = `SELECT COUNT(*) AS count FROM conversation_members me
   JOIN messages x ON x.conversation_id = me.conversation_id
   WHERE me.user_id = ?1 AND x.sender_id != ?1 AND x.id > me.last_read_id`

/**
 * Messages with what the viewer ?2 may see of each attachment. `where` filters messages `m` (conversation ?1, and
 * ?3/?4 as the variant needs).
 */
const messagesSql = (where: string, order: string) => `SELECT m.id, m.sender_id AS senderId, m.body,
     m.attachment_type AS attachmentType, m.attachment_id AS attachmentId, m.created_at AS createdAt,
     p.name AS placeName, p.city AS placeCity, p.category AS placeCategory,
     l.title AS listTitle, l.city AS listCity, l.owner_id AS listOwnerId, l.visibility AS listVisibility,
     (SELECT COUNT(*) FROM list_items li WHERE li.list_id = l.id) AS listItemCount,
     EXISTS (SELECT 1 FROM list_members lm WHERE lm.list_id = l.id AND lm.user_id = ?2) AS listIsMember,
     EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = l.owner_id AND bk.blocked_id = ?2)
                                        OR (bk.blocker_id = ?2 AND bk.blocked_id = l.owner_id)) AS listBlocked
   FROM messages m
   LEFT JOIN places p ON m.attachment_type = 'place' AND p.id = m.attachment_id
   LEFT JOIN lists l ON m.attachment_type = 'list' AND l.id = m.attachment_id
   WHERE m.conversation_id = ?1 AND ${where}
   ORDER BY m.id ${order}`

/** ?1 conversation, ?2 viewer, ?3 after id, ?4 limit: the first ?4 messages after ?3, oldest first. */
export const MESSAGES_AFTER_SQL = messagesSql('m.id > ?3', 'ASC LIMIT ?4')
/** ?1 conversation, ?2 viewer, ?3 limit: the newest ?3 messages, NEWEST first (reverse before returning). */
export const MESSAGES_LATEST_SQL = messagesSql('?3 > 0', 'DESC LIMIT ?3')
/** ?1 conversation, ?2 viewer, ?3 message id: one message (the response of POST …/messages). */
export const MESSAGE_BY_ID_SQL = messagesSql('m.id = ?3', 'ASC')

/** ?1 conversation, ?2 sender, ?3 body, ?4 attachment type, ?5 attachment id, ?6 created_at. */
export const INSERT_MESSAGE_SQL = `INSERT INTO messages (conversation_id, sender_id, body, attachment_type, attachment_id, created_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`

/** ?1 sender, ?2 cutoff (rateCutoff). */
export const RECENT_SENT_SQL = `SELECT COUNT(*) AS n FROM messages WHERE sender_id = ?1 AND created_at > ?2`

export const PLACE_EXISTS_SQL = `SELECT 1 AS ok FROM places WHERE id = ?1`
/** List ?1 as seen by ?2 (canViewList). */
export const LIST_VIEW_SQL = `SELECT l.owner_id AS ownerId, l.visibility,
     EXISTS (SELECT 1 FROM list_members lm WHERE lm.list_id = l.id AND lm.user_id = ?2) AS isMember,
     EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = l.owner_id AND bk.blocked_id = ?2)
                                        OR (bk.blocker_id = ?2 AND bk.blocked_id = l.owner_id)) AS blocked
   FROM lists l WHERE l.id = ?1`

/** POST /conversations/:id/read: ?1 conversation, ?2 reader, ?3 now. Everything up to the newest message is read. */
export const MARK_READ_SQL = `UPDATE conversation_members
   SET last_read_id = COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id = ?1), 0), last_read_at = ?3
   WHERE conversation_id = ?1 AND user_id = ?2`

/**
 * DELETE /me (?1 = the user): their conversations end with the account — every message in them, then the
 * memberships (both sides), then the conversations (pair_key "<id>:…" or "…:<id>"). Run in this order, in one transaction.
 */
export const DELETE_ACCOUNT_SQL: readonly string[] = [
  `DELETE FROM messages WHERE sender_id = ?1
     OR conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?1)`,
  `DELETE FROM conversation_members
     WHERE conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?1)`,
  `DELETE FROM conversations WHERE pair_key LIKE ?1 || ':%' OR pair_key LIKE '%:' || ?1`,
]

// ---------- Output ----------
export interface ConversationOut {
  id: number
  other: { id: number; handle: string | null }
  lastMessage: { body: string; attachmentType: AttachmentType | null; createdAt: string; senderId: number } | null
  unread: number
}

/** A CONVERSATIONS_SQL row -> GET /conversations item. */
export function toConversation(r: Record<string, unknown>): ConversationOut {
  return {
    id: Number(r.id),
    other: { id: Number(r.otherId), handle: (r.otherHandle as string | null) ?? null },
    lastMessage: r.lastId === null || r.lastId === undefined ? null : {
      body: String(r.lastBody ?? ''),
      attachmentType: (r.lastAttachmentType as AttachmentType | null) ?? null,
      createdAt: String(r.lastCreatedAt),
      senderId: Number(r.lastSenderId),
    },
    unread: Number(r.unread ?? 0),
  }
}

export interface AttachmentOut {
  type: AttachmentType
  id: number
  title: string
  subtitle: string | null
  /** Place category (for the icon); null for lists. */
  category: string | null
}

export interface MessageOut {
  id: number
  senderId: number
  body: string
  attachment: AttachmentOut | null
  createdAt: string
}

/** "Roma · 12 yer". */
export const listSubtitle = (city: unknown, count: unknown): string =>
  [typeof city === 'string' && city ? city : null, `${Number(count ?? 0)} yer`].filter(Boolean).join(' · ')

/**
 * A messages row -> API message, as `viewer` may see it. A list the viewer cannot open (private, deleted, or a block
 * with its owner) shows only PRIVATE_LIST_TITLE: no title, city or size.
 */
export function toMessage(r: Record<string, unknown>, viewer: number): MessageOut {
  let attachment: AttachmentOut | null = null
  const type = r.attachmentType as AttachmentType | null
  const id = Number(r.attachmentId)
  if (type === 'place') {
    const exists = typeof r.placeName === 'string'
    attachment = {
      type, id, title: exists ? (r.placeName as string) : MISSING_PLACE_TITLE,
      subtitle: exists ? ((r.placeCity as string | null) ?? null) : null,
      category: exists ? ((r.placeCategory as string | null) ?? null) : null,
    }
  } else if (type === 'list') {
    const exists = r.listOwnerId !== null && r.listOwnerId !== undefined
    const visible = exists && canViewList(
      { ownerId: r.listOwnerId, visibility: r.listVisibility, isMember: r.listIsMember, blocked: r.listBlocked }, viewer)
    attachment = visible
      ? { type, id, title: String(r.listTitle), subtitle: listSubtitle(r.listCity, r.listItemCount), category: null }
      : { type, id, title: PRIVATE_LIST_TITLE, subtitle: null, category: null }
  }
  return { id: Number(r.id), senderId: Number(r.senderId), body: String(r.body ?? ''), attachment, createdAt: String(r.createdAt) }
}
