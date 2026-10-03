import { HttpException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { q } from '../common/util'
import {
  ADD_MEMBERS_SQL, CONVERSATION_BY_PAIR_SQL, CONVERSATIONS_SQL, CREATE_CONVERSATION_SQL, decideOpen, INSERT_MESSAGE_SQL,
  LIST_VIEW_SQL, MARK_READ_SQL, MEMBER_SQL, MessageError, MESSAGE_BY_ID_SQL, MESSAGES_AFTER_SQL, MESSAGES_LATEST_SQL,
  OPEN_FACTS_SQL, PLACE_EXISTS_SQL, pairKey, parseConversationHandle, parseMessageInput, parseMessagesQuery, rateCutoff,
  RECENT_SENT_SQL, requireAttachable, requireCanSend, requireMember, requireRate, toConversation, toMessage, UNREAD_SQL,
} from './messages-core'

/** messages-core error -> HttpException with the same status (AllExceptionsFilter renders `{error}`). */
async function core<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn() } catch (e) {
    if (e instanceof MessageError) throw new HttpException(e.message, e.status)
    throw e
  }
}

/** MSG (docs/ACCEPTANCE.md): same rules and SQL as the Worker (backend/src/routes/messages.ts). */
@Injectable()
export class MessagesService {
  constructor(private db: DataSource) {}

  private async membership(me: number, id: number) {
    const [row] = await q(this.db, MEMBER_SQL, [id, me])
    return requireMember(row)
  }

  list(me: number) {
    return core(async () => (await q(this.db, CONVERSATIONS_SQL, [me])).map(toConversation))
  }

  unread(me: number) {
    return core(async () => {
      const [r] = await q(this.db, UNREAD_SQL, [me])
      return { count: Number(r?.count ?? 0) }
    })
  }

  /** [status, body]: 200 with the existing conversation, 201 with a new one. */
  open(me: number, body: any): Promise<[number, { id: number }]> {
    return core(async () => {
      const handle = parseConversationHandle(body?.handle)
      const [target] = await q(this.db, 'SELECT id FROM users WHERE handle = ?1', [handle])
      const targetId = target ? Number(target.id) : null
      const key = pairKey(me, targetId ?? 0)
      const [facts] = await q(this.db, OPEN_FACTS_SQL, [me, targetId ?? 0, key])
      const existingId = facts?.existingId === null || facts?.existingId === undefined ? null : Number(facts.existingId)
      const outcome = decideOpen({ targetId, me, blocked: facts?.blocked === 1, mutual: facts?.mutual === 1, existingId })
      if (outcome === 'existing') return [200, { id: existingId! }] as [number, { id: number }]
      const id = await this.db.transaction(async (m) => {
        await q(m, CREATE_CONVERSATION_SQL, [key, new Date().toISOString()])
        await q(m, ADD_MEMBERS_SQL, [key, me, targetId])
        const [row] = await q(m, CONVERSATION_BY_PAIR_SQL, [key])
        return Number(row.id)
      })
      return [201, { id }] as [number, { id: number }]
    })
  }

  get(me: number, id: number) {
    return core(async () => {
      const m = await this.membership(me, id)
      return { id, other: m.other, canSend: m.canSend }
    })
  }

  messages(me: number, id: number, afterRaw: unknown, limitRaw: unknown) {
    return core(async () => {
      await this.membership(me, id)
      const { after, limit } = parseMessagesQuery(afterRaw, limitRaw)
      const rows = after === null
        ? (await q(this.db, MESSAGES_LATEST_SQL, [id, me, limit])).reverse()
        : await q(this.db, MESSAGES_AFTER_SQL, [id, me, after, limit])
      return rows.map((r: any) => toMessage(r, me))
    })
  }

  send(me: number, id: number, body: any) {
    return core(async () => {
      const m = await this.membership(me, id)
      const input = parseMessageInput(body?.body, body?.attachment)
      requireCanSend(m)
      const at = new Date()
      const [recent] = await q(this.db, RECENT_SENT_SQL, [me, rateCutoff(at)])
      requireRate(Number(recent?.n ?? 0))
      if (input.attachment) {
        const { type, id: targetId } = input.attachment
        const placeExists = type === 'place' && (await q(this.db, PLACE_EXISTS_SQL, [targetId])).length > 0
        const [list] = type === 'list' ? await q(this.db, LIST_VIEW_SQL, [targetId, me]) : [null]
        requireAttachable(type, placeExists, list, me)
      }
      const [inserted] = await q(this.db, INSERT_MESSAGE_SQL,
        [id, me, input.body, input.attachment?.type ?? null, input.attachment?.id ?? null, at.toISOString()])
      const [row] = await q(this.db, MESSAGE_BY_ID_SQL, [id, me, inserted.id])
      return toMessage(row, me)
    })
  }

  read(me: number, id: number) {
    return core(async () => {
      await this.membership(me, id)
      await q(this.db, MARK_READ_SQL, [id, me, new Date().toISOString()])
      return { ok: true }
    })
  }
}
