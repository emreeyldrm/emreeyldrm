// List copying and shared (collaborative) lists (docs/ACCEPTANCE.md, "Liste kopyalama, ortak listeler" — CPY, COL).
//
// THIS FILE IS SHARED VERBATIM between server/src/lists/collab-core.ts (NestJS) and
// backend/src/collab-core.ts (Cloudflare Worker). Edit one, then copy it over the other:
//   cp server/src/lists/collab-core.ts backend/src/collab-core.ts
// server/test/unit/collab-core.spec.ts fails if the two copies differ.
//
// There is no row-level security: every list endpoint loads ACCESS_SQL for (list, requester) and asks one of the
// decision functions below. Pure functions only: no framework, database or runtime dependencies.

import type { PlaceDetails } from './details-core'

export const MAX_MEMBERS = 20
export const MAX_TITLE = 200
export const COPY_SUFFIX = ' (kopya)'

export type ListRole = 'owner' | 'editor'

/** Error with an HTTP status; both servers map it to `{error}` with that status. */
export class CollabError extends Error {
  constructor(public status: 400 | 403 | 404, message: string) { super(message) }
}

const NOT_FOUND = 'Liste bulunamadı'
const OWNER_ONLY = 'Bunu yalnızca listenin sahibi yapabilir'

/**
 * One row per (list ?1, requester ?2): owner, visibility, copy permission, membership and block relation.
 * No row = the list does not exist.
 */
export const ACCESS_SQL = `SELECT l.owner_id AS ownerId, l.visibility, l.allow_copy AS allowCopy,
     EXISTS (SELECT 1 FROM list_members lm WHERE lm.list_id = l.id AND lm.user_id = ?2) AS isMember,
     EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = l.owner_id AND bk.blocked_id = ?2)
                                        OR (bk.blocker_id = ?2 AND bk.blocked_id = l.owner_id)) AS blocked
   FROM lists l WHERE l.id = ?1`

export interface AccessRow {
  ownerId: number
  visibility: string
  allowCopy: unknown
  isMember: unknown
  blocked: unknown
}

export interface ListAccess {
  /** The requester's role, or null for everyone else (including viewers of a public list). */
  role: ListRole | null
  /** GET /lists/:id: owner, member, or a public list without a block relation. */
  canView: boolean
  allowCopy: boolean
  ownerId: number
}

const truthy = (v: unknown) => v === 1 || v === true || v === '1'

/** Access of `me` to a list (row from ACCESS_SQL); null when the list does not exist. */
export function listAccess(row: AccessRow | null | undefined, me: number): ListAccess | null {
  if (!row) return null
  const role: ListRole | null = Number(row.ownerId) === me ? 'owner' : truthy(row.isMember) ? 'editor' : null
  const canView = role !== null || (row.visibility === 'public' && !truthy(row.blocked))
  return { role, canView, allowCopy: truthy(row.allowCopy), ownerId: Number(row.ownerId) }
}

/** GET /lists/:id. Private list for a non-member (and any block relation) stays 404. */
export function requireView(a: ListAccess | null): ListAccess {
  if (!a || !a.canView) throw new CollabError(404, NOT_FOUND)
  return a
}

/** PUT /lists/:id/items, GET /lists/:id/members: owner or editor; everyone else 404. */
export function requireEditor(a: ListAccess | null): ListAccess & { role: ListRole } {
  if (!a || !a.role) throw new CollabError(404, NOT_FOUND)
  return a as ListAccess & { role: ListRole }
}

/** PATCH/DELETE /lists/:id, POST /lists/:id/members: owner only; editor 403; everyone else 404 (as before). */
export function requireOwner(a: ListAccess | null): ListAccess {
  if (!a || !a.role) throw new CollabError(404, NOT_FOUND)
  if (a.role !== 'owner') throw new CollabError(403, OWNER_ONLY)
  return a
}

/** POST /lists/:id/copy: hidden list 404; the owner always; others need allowCopy (else 403). */
export function requireCopy(a: ListAccess | null): ListAccess {
  const v = requireView(a)
  if (v.role !== 'owner' && !v.allowCopy) throw new CollabError(403, 'Bu liste kopyalanamaz')
  return v
}

/** DELETE /lists/:id/members/:userId: the owner removes any member, an editor only themself. */
export function requireRemoveMember(a: ListAccess | null, me: number, target: number): void {
  const v = requireEditor(a)
  if (target === v.ownerId) throw new CollabError(400, 'Liste sahibi listeden çıkarılamaz')
  if (v.role === 'owner' || target === me) return
  throw new CollabError(403, OWNER_ONLY)
}

export interface AddMemberFacts {
  /** Target user id (null when the handle does not exist). */
  targetId: number | null
  ownerId: number
  /** Block in either direction between owner and target. */
  blocked: boolean
  /** Owner and target follow each other (friends). */
  mutual: boolean
  alreadyMember: boolean
  memberCount: number
}

/**
 * POST /lists/:id/members {handle} (owner already checked): 'added' (201), 'exists' (200, no change) or an error:
 * unknown handle 404, the owner themself 400, block 403, not friends 403, full (20 members) 400.
 */
export function decideAddMember(f: AddMemberFacts): 'added' | 'exists' {
  if (f.targetId === null) throw new CollabError(404, 'Kullanıcı bulunamadı')
  if (f.targetId === f.ownerId) throw new CollabError(400, 'Liste sahibi zaten listede')
  if (f.blocked) throw new CollabError(403, 'Bu kullanıcı eklenemez')
  if (f.alreadyMember) return 'exists'
  if (!f.mutual) throw new CollabError(403, 'Yalnızca arkadaşların (karşılıklı takip) eklenebilir')
  if (f.memberCount >= MAX_MEMBERS) throw new CollabError(400, `Bir listede en çok ${MAX_MEMBERS} üye olabilir`)
  return 'added'
}

/** `handle` of POST /lists/:id/members. */
export function parseMemberHandle(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new CollabError(400, 'handle gerekli')
  return v.trim().toLowerCase()
}

// ---------- Photos on shared lists (AC-COL-5) ----------
export interface ItemPhotos { provider: string; providerId: string; details: PlaceDetails }

const placeKey = (provider: string, providerId: string) => `${provider}\u0000${providerId}`

/**
 * Photo ids of the new items that the requester must own: every photo except those already stored on the same
 * place (provider, providerId) in this list. So an owner or editor re-saving the list keeps photos another member
 * added, but cannot attach someone else's media anew (nor move it to another place).
 */
export function photosNeedingOwnership(stored: readonly ItemPhotos[], incoming: readonly ItemPhotos[]): string[] {
  const kept = new Map<string, Set<string>>()
  for (const s of stored) kept.set(placeKey(s.provider, s.providerId), new Set(s.details.photos ?? []))
  const out = new Set<string>()
  for (const it of incoming) {
    const existing = kept.get(placeKey(it.provider, it.providerId))
    for (const id of it.details.photos ?? []) if (!existing?.has(id)) out.add(id)
  }
  return [...out]
}

// ---------- Copy (CPY) ----------
/** "<title> (kopya)", within the 200-character title limit. */
export function copyTitle(title: string): string {
  return title.slice(0, MAX_TITLE - COPY_SUFFIX.length) + COPY_SUFFIX
}

/** Details of a copied item: everything but photos (someone else's media). */
export function copyDetails(d: PlaceDetails): PlaceDetails {
  const { photos: _photos, ...rest } = d
  return rest
}
