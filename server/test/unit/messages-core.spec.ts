import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canViewList, decideOpen, DEFAULT_LIMIT, listSubtitle, MAX_BODY, MessageError, pairKey, parseConversationHandle,
  parseMessageInput, parseMessagesQuery, PRIVATE_LIST_TITLE, RATE_LIMIT, rateCutoff, requireAttachable, requireCanSend,
  requireMember, requireRate, toConversation, toMessage, type OpenFacts,
} from '../../src/messages/messages-core'

const root = join(__dirname, '..', '..', '..')
const status = (fn: () => unknown) => { try { fn(); return 'ok' } catch (e) { return (e as MessageError).status } }

describe('messages-core', () => {
  it('is byte-identical in server/ (NestJS) and backend/ (Worker)', () => {
    const nest = readFileSync(join(root, 'server', 'src', 'messages', 'messages-core.ts'), 'utf8')
    const worker = readFileSync(join(root, 'backend', 'src', 'messages-core.ts'), 'utf8')
    expect(worker).toBe(nest)
  })

  it('pairKey is order-independent', () => {
    expect(pairKey(3, 12)).toBe('3:12')
    expect(pairKey(12, 3)).toBe('3:12')
  })

  it('parseConversationHandle trims and lowercases; missing/non-string 400', () => {
    expect(parseConversationHandle('  Ali_1 ')).toBe('ali_1')
    expect(status(() => parseConversationHandle(''))).toBe(400)
    expect(status(() => parseConversationHandle(undefined))).toBe(400)
    expect(status(() => parseConversationHandle(5))).toBe(400)
  })

  it('parseMessageInput: text 1-2000 (trimmed) or an attachment', () => {
    expect(parseMessageInput(' hi ', undefined)).toEqual({ body: 'hi', attachment: null })
    expect(parseMessageInput(undefined, { type: 'place', id: 3 })).toEqual({ body: '', attachment: { type: 'place', id: 3 } })
    expect(parseMessageInput('bak', { type: 'list', id: 9, extra: 1 })).toEqual({ body: 'bak', attachment: { type: 'list', id: 9 } })
    expect(parseMessageInput('x'.repeat(MAX_BODY), null).body).toHaveLength(MAX_BODY)
    for (const [body, att] of [
      [undefined, undefined], ['', null], ['   ', undefined], [12, undefined], ['x'.repeat(MAX_BODY + 1), undefined],
      ['x', { type: 'user', id: 1 }], ['x', { type: 'place', id: 1.5 }], ['x', { type: 'place', id: 0 }],
      ['x', { type: 'place', id: '3' }], ['x', 'place'], ['x', [1]],
    ] as const) expect(status(() => parseMessageInput(body, att))).toBe(400)
  })

  it('parseMessagesQuery: defaults, bounds and invalid values', () => {
    expect(parseMessagesQuery(undefined, undefined)).toEqual({ after: null, limit: DEFAULT_LIMIT })
    expect(parseMessagesQuery('', '')).toEqual({ after: null, limit: DEFAULT_LIMIT })
    expect(parseMessagesQuery('15', '10')).toEqual({ after: 15, limit: 10 })
    expect(parseMessagesQuery('0', '100')).toEqual({ after: 0, limit: 100 })
    for (const [a, l] of [['-1', undefined], ['x', undefined], [undefined, '0'], [undefined, '101'], [undefined, '2.5'], [['1'], undefined]])
      expect(status(() => parseMessagesQuery(a, l))).toBe(400)
  })

  it('decideOpen: unknown 404, self 400, block 403, existing 200 before the friend check, not friends 403', () => {
    const f = (o: Partial<OpenFacts>): OpenFacts => ({ targetId: 2, me: 1, blocked: false, mutual: true, existingId: null, ...o })
    expect(decideOpen(f({}))).toBe('create')
    expect(decideOpen(f({ existingId: 5 }))).toBe('existing')
    expect(decideOpen(f({ existingId: 5, mutual: false }))).toBe('existing')
    expect(status(() => decideOpen(f({ targetId: null })))).toBe(404)
    expect(status(() => decideOpen(f({ targetId: 1 })))).toBe(400)
    expect(status(() => decideOpen(f({ blocked: true, existingId: 5 })))).toBe(403)
    expect(status(() => decideOpen(f({ mutual: false })))).toBe(403)
  })

  it('requireMember / requireCanSend / requireRate', () => {
    expect(status(() => requireMember(null))).toBe(404)
    const m = requireMember({ otherId: 2, otherHandle: 'bob', blocked: 0, mutual: 1 })
    expect(m).toEqual({ other: { id: 2, handle: 'bob' }, canSend: true, blocked: false, mutual: true })
    expect(status(() => requireCanSend(m))).toBe('ok')
    expect(requireMember({ otherId: 2, otherHandle: 'bob', blocked: 1, mutual: 0 }).canSend).toBe(false)
    expect(status(() => requireCanSend(requireMember({ otherId: 2, otherHandle: 'b', blocked: 1, mutual: 1 })))).toBe(403)
    expect(status(() => requireCanSend(requireMember({ otherId: 2, otherHandle: 'b', blocked: 0, mutual: 0 })))).toBe(403)
    expect(status(() => requireRate(RATE_LIMIT - 1))).toBe('ok')
    expect(status(() => requireRate(RATE_LIMIT))).toBe(429)
    expect(rateCutoff(new Date('2026-01-01T00:01:00.000Z'))).toBe('2026-01-01T00:00:00.000Z')
  })

  it('canViewList / requireAttachable follow the GET /lists/:id rule', () => {
    const row = { ownerId: 1, visibility: 'private', isMember: 0, blocked: 0 }
    expect(canViewList(null, 1)).toBe(false)
    expect(canViewList(row, 1)).toBe(true)
    expect(canViewList(row, 2)).toBe(false)
    expect(canViewList({ ...row, isMember: 1 }, 2)).toBe(true)
    expect(canViewList({ ...row, visibility: 'public' }, 2)).toBe(true)
    expect(canViewList({ ...row, visibility: 'public', blocked: 1 }, 2)).toBe(false)
    expect(status(() => requireAttachable('place', true, null, 2))).toBe('ok')
    expect(status(() => requireAttachable('place', false, null, 2))).toBe(400)
    expect(status(() => requireAttachable('list', false, row, 1))).toBe('ok')
    expect(status(() => requireAttachable('list', false, row, 2))).toBe(400)
    expect(status(() => requireAttachable('list', false, null, 2))).toBe(400)
  })

  it('toConversation maps rows (no messages -> lastMessage null)', () => {
    expect(toConversation({ id: 4, otherId: 2, otherHandle: 'bob', lastId: null, unread: 0 }))
      .toEqual({ id: 4, other: { id: 2, handle: 'bob' }, lastMessage: null, unread: 0 })
    expect(toConversation({
      id: 4, otherId: 2, otherHandle: 'bob', lastId: 9, lastBody: '', lastAttachmentType: 'place',
      lastCreatedAt: '2026-01-01T00:00:00.000Z', lastSenderId: 2, unread: 3,
    }).lastMessage).toEqual({ body: '', attachmentType: 'place', createdAt: '2026-01-01T00:00:00.000Z', senderId: 2 })
  })

  it('toMessage: place/list attachments; a list the viewer cannot open shows only "Özel liste"', () => {
    const base = { id: 1, senderId: 1, body: 'x', createdAt: 't', attachmentType: null, attachmentId: null }
    expect(toMessage(base, 2)).toEqual({ id: 1, senderId: 1, body: 'x', attachment: null, createdAt: 't' })
    expect(toMessage({ ...base, attachmentType: 'place', attachmentId: 7, placeName: 'Galata', placeCity: 'Istanbul', placeCategory: 'historic' }, 2).attachment)
      .toEqual({ type: 'place', id: 7, title: 'Galata', subtitle: 'Istanbul', category: 'historic' })
    expect(toMessage({ ...base, attachmentType: 'place', attachmentId: 7, placeName: null }, 2).attachment?.subtitle).toBeNull()
    const list = { ...base, attachmentType: 'list', attachmentId: 5, listTitle: 'Gizli', listCity: 'Roma', listOwnerId: 1,
      listVisibility: 'private', listItemCount: 3, listIsMember: 0, listBlocked: 0 }
    expect(toMessage(list, 1).attachment).toEqual({ type: 'list', id: 5, title: 'Gizli', subtitle: 'Roma · 3 yer', category: null })
    expect(toMessage(list, 2).attachment).toEqual({ type: 'list', id: 5, title: PRIVATE_LIST_TITLE, subtitle: null, category: null })
    expect(toMessage({ ...list, listIsMember: 1 }, 2).attachment?.title).toBe('Gizli')
    expect(toMessage({ ...list, listVisibility: 'public' }, 2).attachment?.title).toBe('Gizli')
    expect(toMessage({ ...list, listVisibility: 'public', listBlocked: 1 }, 2).attachment?.title).toBe(PRIVATE_LIST_TITLE)
    expect(toMessage({ ...list, listOwnerId: null }, 1).attachment?.title).toBe(PRIVATE_LIST_TITLE)
    expect(listSubtitle(null, 0)).toBe('0 yer')
  })
})
