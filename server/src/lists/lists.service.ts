import { HttpException, Injectable } from '@nestjs/common'
import { DataSource, EntityManager } from 'typeorm'
import { List, ListItem, ListMember, Place } from '../database/entities'
import { blockedBetween, bool, CATEGORIES, now, q } from '../common/util'
import { CreateListDto, ReplaceItemsDto, UpdateListDto } from './lists.dto'
import { DetailsError, parseDetails, readStoredDetails, type PlaceDetails } from './details-core'
import {
  ACCESS_SQL, CollabError, copyDetails, copyTitle, decideAddMember, listAccess, parseMemberHandle,
  photosNeedingOwnership, requireCopy, requireEditor, requireOwner, requireRemoveMember, requireView,
  type ListAccess,
} from './collab-core'
import { requireOwnMedia } from '../media/media'

/** collab-core / details-core errors -> HTTP errors with the same status. */
function core<T>(fn: () => T): T {
  try { return fn() } catch (e) {
    if (e instanceof CollabError || e instanceof DetailsError) throw new HttpException(e.message, e.status)
    throw e
  }
}

type Runner = DataSource | EntityManager

const MEMBERS_SQL = `SELECT u.id, u.handle, m.role, m.added_at AS addedAt
  FROM list_members m JOIN users u ON u.id = m.user_id WHERE m.list_id = ? ORDER BY m.added_at, u.id`

@Injectable()
export class ListsService {
  constructor(private db: DataSource) {}

  /** Access of `me` to list `id` (collab-core ACCESS_SQL); authorization is decided in code on every request. */
  private async access(me: number, id: number, runner: Runner = this.db): Promise<ListAccess | null> {
    const [row] = await q(runner, ACCESS_SQL, [id, me])
    return listAccess(row, me)
  }

  /** Lists the user owns and lists they are a member (editor) of, each with `role` and `ownerHandle`. */
  async mine(me: number) {
    const rows = await q(this.db,
      `SELECT l.id, l.city, l.title, l.visibility, l.allow_copy AS allowCopy, l.allow_comments AS allowComments,
         (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS itemCount, l.updated_at AS updatedAt,
         CASE WHEN l.owner_id = ?1 THEN 'owner' ELSE 'editor' END AS role, u.handle AS ownerHandle
       FROM lists l JOIN users u ON u.id = l.owner_id
       WHERE l.owner_id = ?1 OR EXISTS (SELECT 1 FROM list_members lm WHERE lm.list_id = l.id AND lm.user_id = ?1)
       ORDER BY l.updated_at DESC, l.id DESC`, [me])
    return rows.map((r: any) => ({ ...r, allowCopy: bool(r.allowCopy), allowComments: bool(r.allowComments) }))
  }

  async create(me: number, dto: CreateListDto) {
    const t = now()
    const l = await this.db.getRepository(List).save({
      ownerId: me, city: dto.city, title: dto.title, visibility: dto.visibility ?? 'private',
      allowCopy: true, allowComments: true, createdAt: t, updatedAt: t,
    })
    return { id: l.id }
  }

  /** Owner only (editor 403, anyone else 404). */
  async update(me: number, id: number, dto: UpdateListDto) {
    const a = await this.access(me, id)
    core(() => requireOwner(a))
    const patch: Partial<List> = { updatedAt: now() }
    if (dto.title !== undefined) patch.title = dto.title
    if (dto.visibility !== undefined) patch.visibility = dto.visibility
    if (dto.allowCopy !== undefined) patch.allowCopy = dto.allowCopy
    if (dto.allowComments !== undefined) patch.allowComments = dto.allowComments
    await this.db.getRepository(List).update(id, patch)
    return { ok: true }
  }

  /** Owner only; items and memberships go with the list (FK cascade). */
  async remove(me: number, id: number) {
    const a = await this.access(me, id)
    core(() => requireOwner(a))
    await this.db.getRepository(List).delete(id)
    return { ok: true }
  }

  /** Owner or editor. New photo ids must be the requester's; photos already on the same item may stay (AC-COL-5). */
  async replaceItems(me: number, id: number, dto: ReplaceItemsDto, at: Date = new Date()) {
    const details: PlaceDetails[] = core(() => dto.items.map((it) => parseDetails(it.details)))
    const a = await this.access(me, id)
    core(() => requireEditor(a))
    const stored = (await q(this.db,
      `SELECT p.provider, p.provider_id AS providerId, i.details FROM list_items i JOIN places p ON p.id = i.place_id
       WHERE i.list_id = ?`, [id])).map((r: any) => ({ ...r, details: readStoredDetails(r.details) }))
    const incoming = dto.items.map((it, i) => ({ provider: it.provider, providerId: it.providerId, details: details[i] }))
    await requireOwnMedia(this.db, me, photosNeedingOwnership(stored, incoming))
    const detailsOf = new Map(dto.items.map((it, i) => [it, details[i]]))
    // The same place twice in one request would collide on the primary key: keep the first.
    const seen = new Set<string>()
    const items = dto.items.filter((it) => {
      const k = `${it.provider}\u0000${it.providerId}`
      return seen.has(k) ? false : (seen.add(k), true)
    })
    await this.db.transaction(async (m) => {
      // TRD: places that were not in this list before the request count as a "save" for the requester
      // (owner or editor), once per user + place.
      const before = new Set((await m.getRepository(ListItem).find({ where: { listId: id }, select: { placeId: true } }))
        .map((r) => r.placeId))
      await m.getRepository(ListItem).delete({ listId: id })
      let pos = 0
      for (const it of items) {
        const category = CATEGORIES.includes(it.category ?? '') ? it.category! : 'other'
        let place = await m.getRepository(Place).findOne({ where: { provider: it.provider, providerId: it.providerId } })
        if (!place) {
          place = await m.getRepository(Place).save({
            provider: it.provider, providerId: it.providerId, name: it.name,
            lat: it.lat ?? null, lon: it.lon ?? null, category, city: it.city ?? null,
          })
        }
        await m.getRepository(ListItem).insert({
          listId: id, placeId: place.id, category, note: (it.note ?? '').slice(0, 1000), position: pos++,
          details: JSON.stringify(detailsOf.get(it) ?? {}),
        })
        if (!before.has(place.id)) await this.recordSave(m, place.id, me, at)
      }
      await m.getRepository(List).update(id, { updatedAt: now() })
    })
    return { ok: true, count: items.length }
  }

  private recordSave(m: Runner, placeId: number, me: number, at: Date) {
    return q(m, `INSERT OR IGNORE INTO place_events (place_id, user_id, kind, day, created_at) VALUES (?1, ?2, 'save', '', ?3)`,
      [placeId, me, at.toISOString()])
  }

  /** Owner, editor, or anyone for a public list without a block relation; otherwise 404. */
  async get(me: number, id: number) {
    const a = await this.access(me, id)
    const v = core(() => requireView(a))
    const [l] = await q(this.db,
      `SELECT l.id, l.owner_id AS ownerId, u.handle AS ownerHandle, l.city, l.title, l.visibility,
         l.allow_copy AS allowCopy, l.allow_comments AS allowComments,
         (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id) AS memberCount
       FROM lists l JOIN users u ON u.id = l.owner_id WHERE l.id = ?`, [id])
    const items = await q(this.db,
      `SELECT p.id AS placeId, p.provider, p.provider_id AS providerId, p.name, p.lat, p.lon, i.category, i.note, i.position, i.details
       FROM list_items i JOIN places p ON p.id = i.place_id WHERE i.list_id = ? ORDER BY i.position`, [id])
    return {
      ...l, allowCopy: bool(l.allowCopy), allowComments: bool(l.allowComments), myRole: v.role,
      items: items.map((it: any) => ({ ...it, details: readStoredDetails(it.details) })),
    }
  }

  /** POST /lists/:id/copy: a private copy for the requester; photos are not copied (someone else's media). */
  async copy(me: number, id: number, at: Date = new Date()) {
    const a = await this.access(me, id)
    core(() => requireCopy(a))
    return this.db.transaction(async (m) => {
      const [src] = await q(m, 'SELECT city, title FROM lists WHERE id = ?', [id])
      const t = now()
      const copy = await m.getRepository(List).save({
        ownerId: me, city: src.city, title: copyTitle(src.title), visibility: 'private',
        allowCopy: true, allowComments: true, createdAt: t, updatedAt: t,
      })
      const rows = await q(m, 'SELECT place_id AS placeId, category, note, position, details FROM list_items WHERE list_id = ? ORDER BY position', [id])
      for (const r of rows) {
        await m.getRepository(ListItem).insert({
          listId: copy.id, placeId: r.placeId, category: r.category, note: r.note, position: r.position,
          details: JSON.stringify(copyDetails(readStoredDetails(r.details))),
        })
        // TRD: a save for the copier (once per user + place); never for the original owner.
        await this.recordSave(m, r.placeId, me, at)
      }
      return { id: copy.id }
    })
  }

  // ---------- Members (COL) ----------
  async members(me: number, id: number) {
    const a = await this.access(me, id)
    core(() => requireEditor(a))
    return q(this.db, MEMBERS_SQL, [id])
  }

  /** Owner only. Returns [status, member]: 201 when added, 200 when already a member. */
  async addMember(me: number, id: number, body: { handle?: unknown }): Promise<[number, unknown]> {
    const a = await this.access(me, id)
    const owner = core(() => requireOwner(a))
    const handle = core(() => parseMemberHandle(body?.handle))
    const [target] = await q(this.db, 'SELECT id FROM users WHERE handle = ?', [handle])
    const targetId: number | null = target ? Number(target.id) : null
    const [facts] = await q(this.db,
      `SELECT ${blockedBetween('?1', '?2')} AS blocked,
         EXISTS (SELECT 1 FROM follows a JOIN follows b ON b.follower_id = a.followee_id AND b.followee_id = a.follower_id
                 WHERE a.follower_id = ?1 AND a.followee_id = ?2) AS mutual,
         EXISTS (SELECT 1 FROM list_members WHERE list_id = ?3 AND user_id = ?2) AS alreadyMember,
         (SELECT COUNT(*) FROM list_members WHERE list_id = ?3) AS memberCount`,
      [owner.ownerId, targetId ?? 0, id])
    const outcome = core(() => decideAddMember({
      targetId, ownerId: owner.ownerId, blocked: bool(facts.blocked), mutual: bool(facts.mutual),
      alreadyMember: bool(facts.alreadyMember), memberCount: Number(facts.memberCount),
    }))
    if (outcome === 'added') {
      await this.db.getRepository(ListMember).insert({ listId: id, userId: targetId!, role: 'editor', addedAt: now() })
    }
    const [member] = (await q(this.db, MEMBERS_SQL, [id])).filter((r: any) => r.id === targetId)
    return [outcome === 'added' ? 201 : 200, member]
  }

  /** The owner removes anyone; an editor removes only themself. Idempotent for non-members. */
  async removeMember(me: number, id: number, userId: number) {
    const a = await this.access(me, id)
    core(() => requireRemoveMember(a, me, userId))
    await this.db.getRepository(ListMember).delete({ listId: id, userId })
    return { ok: true }
  }
}
