import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCESS_SQL, CollabError, copyDetails, copyTitle, decideAddMember, listAccess, MAX_MEMBERS, parseMemberHandle,
  photosNeedingOwnership, requireCopy, requireEditor, requireOwner, requireRemoveMember, requireView, type AccessRow,
} from '../../src/lists/collab-core'

const root = join(__dirname, '..', '..', '..')
const A = 'a'.repeat(32)
const B = 'b'.repeat(32)
const C = 'c'.repeat(32)

const row = (o: Partial<AccessRow> = {}): AccessRow => ({ ownerId: 1, visibility: 'private', allowCopy: 1, isMember: 0, blocked: 0, ...o })
const status = (fn: () => unknown) => { try { fn(); return 'ok' } catch (e) { return (e as CollabError).status } }

describe('collab-core', () => {
  it('is byte-identical in server/ (NestJS) and backend/ (Worker)', () => {
    const nest = readFileSync(join(root, 'server', 'src', 'lists', 'collab-core.ts'), 'utf8')
    const worker = readFileSync(join(root, 'backend', 'src', 'collab-core.ts'), 'utf8')
    expect(worker).toBe(nest)
  })

  it('listAccess: owner, editor, public viewer, blocked, private stranger, missing list', () => {
    expect(listAccess(null, 1)).toBeNull()
    expect(listAccess(row(), 1)).toEqual({ role: 'owner', canView: true, allowCopy: true, ownerId: 1 })
    expect(listAccess(row({ isMember: 1 }), 2)).toMatchObject({ role: 'editor', canView: true })
    expect(listAccess(row(), 2)).toMatchObject({ role: null, canView: false })
    expect(listAccess(row({ visibility: 'public' }), 2)).toMatchObject({ role: null, canView: true })
    expect(listAccess(row({ visibility: 'public', blocked: 1 }), 2)).toMatchObject({ role: null, canView: false })
    expect(listAccess(row({ allowCopy: false }), 1)?.allowCopy).toBe(false)
  })

  it('decisions keep the private-list 404 for non-members and give editors 403 on owner-only actions', () => {
    const owner = listAccess(row(), 1)
    const editor = listAccess(row({ isMember: 1 }), 2)
    const viewer = listAccess(row({ visibility: 'public' }), 3)
    const stranger = listAccess(row(), 3)
    const table: [string, (a: any) => unknown, unknown[]][] = [
      ['view', requireView, ['ok', 'ok', 'ok', 404, 404]],
      ['edit items', requireEditor, ['ok', 'ok', 404, 404, 404]],
      ['owner only', requireOwner, ['ok', 403, 404, 404, 404]],
      ['copy', requireCopy, ['ok', 'ok', 'ok', 404, 404]],
    ]
    for (const [, fn, expected] of table) {
      expect([owner, editor, viewer, stranger, null].map((a) => status(() => fn(a)))).toEqual(expected)
    }
    const noCopy = (me: number, o: Partial<AccessRow> = {}) => status(() => requireCopy(listAccess(row({ allowCopy: 0, ...o }), me)))
    expect(noCopy(1)).toBe('ok')
    expect(noCopy(2, { isMember: 1 })).toBe(403)
    expect(noCopy(3, { visibility: 'public' })).toBe(403)
    expect(noCopy(3, { visibility: 'public', blocked: 1 })).toBe(404)
  })

  it('member removal: owner removes anyone but themself, editor only themself', () => {
    const owner = listAccess(row(), 1)
    const editor = listAccess(row({ isMember: 1 }), 2)
    expect(status(() => requireRemoveMember(owner, 1, 2))).toBe('ok')
    expect(status(() => requireRemoveMember(owner, 1, 1))).toBe(400)
    expect(status(() => requireRemoveMember(editor, 2, 2))).toBe('ok')
    expect(status(() => requireRemoveMember(editor, 2, 5))).toBe(403)
    expect(status(() => requireRemoveMember(editor, 2, 1))).toBe(400)
    expect(status(() => requireRemoveMember(listAccess(row({ visibility: 'public' }), 3), 3, 3))).toBe(404)
    expect(status(() => requireRemoveMember(null, 3, 3))).toBe(404)
  })

  it('decideAddMember follows AC-COL-1 order', () => {
    const f = { targetId: 2, ownerId: 1, blocked: false, mutual: true, alreadyMember: false, memberCount: 0 }
    expect(decideAddMember(f)).toBe('added')
    expect(status(() => decideAddMember({ ...f, targetId: null }))).toBe(404)
    expect(status(() => decideAddMember({ ...f, targetId: 1 }))).toBe(400)
    expect(status(() => decideAddMember({ ...f, blocked: true }))).toBe(403)
    expect(status(() => decideAddMember({ ...f, blocked: true, alreadyMember: true }))).toBe(403)
    expect(status(() => decideAddMember({ ...f, mutual: false }))).toBe(403)
    expect(decideAddMember({ ...f, alreadyMember: true, memberCount: MAX_MEMBERS })).toBe('exists')
    expect(status(() => decideAddMember({ ...f, memberCount: MAX_MEMBERS - 1 }))).toBe('ok')
    expect(status(() => decideAddMember({ ...f, memberCount: MAX_MEMBERS }))).toBe(400)
  })

  it('parseMemberHandle', () => {
    expect(parseMemberHandle(' Ali_1 ')).toBe('ali_1')
    for (const v of [undefined, null, '', '  ', 5, {}]) expect(status(() => parseMemberHandle(v))).toBe(400)
  })

  it('photosNeedingOwnership: photos already on the same place may stay; new or moved ones must be owned (AC-COL-5)', () => {
    const stored = [
      { provider: 'osm', providerId: 'N1', details: { photos: [A, B] } },
      { provider: 'osm', providerId: 'N2', details: {} },
    ]
    expect(photosNeedingOwnership(stored, [
      { provider: 'osm', providerId: 'N1', details: { photos: [A, B] } },
    ])).toEqual([])
    expect(photosNeedingOwnership(stored, [
      { provider: 'osm', providerId: 'N1', details: { photos: [B, C] } },
      { provider: 'osm', providerId: 'N2', details: { photos: [A] } },
      { provider: 'osm', providerId: 'N3', details: { photos: [C] } },
    ])).toEqual([C, A])
    expect(photosNeedingOwnership([], [{ provider: 'x', providerId: 'y', details: { photos: [A] } }])).toEqual([A])
  })

  it('copy helpers', () => {
    expect(copyTitle('Roma')).toBe('Roma (kopya)')
    expect(copyTitle('x'.repeat(200))).toHaveLength(200)
    expect(copyTitle('x'.repeat(200)).endsWith(' (kopya)')).toBe(true)
    expect(copyDetails({ photos: [A], currency: 'EUR', favorites: ['a'] })).toEqual({ currency: 'EUR', favorites: ['a'] })
    expect(copyDetails({})).toEqual({})
  })

  it('ACCESS_SQL checks membership and blocks in both directions', () => {
    expect(ACCESS_SQL).toMatch(/list_members/)
    expect(ACCESS_SQL).toMatch(/bk\.blocker_id = l\.owner_id AND bk\.blocked_id = \?2/)
    expect(ACCESS_SQL).toMatch(/bk\.blocker_id = \?2 AND bk\.blocked_id = l\.owner_id/)
  })
})
