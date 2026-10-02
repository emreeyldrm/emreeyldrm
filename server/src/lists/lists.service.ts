import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { List, ListItem, Place } from '../database/entities'
import { blockedBetween, bool, CATEGORIES, now, q } from '../common/util'
import { CreateListDto, ReplaceItemsDto, UpdateListDto } from './lists.dto'
import { DetailsError, parseDetails, photoIdsOf, readStoredDetails, type PlaceDetails } from './details-core'
import { requireOwnMedia } from '../media/media'

@Injectable()
export class ListsService {
  constructor(private db: DataSource) {}

  async mine(me: number) {
    const rows = await q(this.db, 
      `SELECT l.id, l.city, l.title, l.visibility, l.allow_copy AS allowCopy, l.allow_comments AS allowComments,
         (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS itemCount, l.updated_at AS updatedAt
       FROM lists l WHERE l.owner_id = ? ORDER BY l.updated_at DESC, l.id DESC`, [me])
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

  private async owned(me: number, id: number) {
    if (!(await this.db.getRepository(List).exist({ where: { id, ownerId: me } })))
      throw new NotFoundException('Liste bulunamadı')
  }

  async update(me: number, id: number, dto: UpdateListDto) {
    await this.owned(me, id)
    const patch: Partial<List> = { updatedAt: now() }
    if (dto.title !== undefined) patch.title = dto.title
    if (dto.visibility !== undefined) patch.visibility = dto.visibility
    if (dto.allowCopy !== undefined) patch.allowCopy = dto.allowCopy
    if (dto.allowComments !== undefined) patch.allowComments = dto.allowComments
    await this.db.getRepository(List).update(id, patch)
    return { ok: true }
  }

  async remove(me: number, id: number) {
    await this.owned(me, id)
    await this.db.getRepository(List).delete(id)
    return { ok: true }
  }

  async replaceItems(me: number, id: number, dto: ReplaceItemsDto) {
    let details: PlaceDetails[]
    try { details = dto.items.map((it) => parseDetails(it.details)) } catch (e) {
      if (e instanceof DetailsError) throw new BadRequestException(e.message)
      throw e
    }
    await this.owned(me, id)
    await requireOwnMedia(this.db, me, photoIdsOf(details))
    const detailsOf = new Map(dto.items.map((it, i) => [it, details[i]]))
    // The same place twice in one request would collide on the primary key: keep the first.
    const seen = new Set<string>()
    const items = dto.items.filter((it) => {
      const k = `${it.provider}\u0000${it.providerId}`
      return seen.has(k) ? false : (seen.add(k), true)
    })
    await this.db.transaction(async (m) => {
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
      }
      await m.getRepository(List).update(id, { updatedAt: now() })
    })
    return { ok: true, count: items.length }
  }

  async get(me: number, id: number) {
    const [l] = await q(this.db, 
      `SELECT l.id, l.owner_id AS ownerId, u.handle AS ownerHandle, l.city, l.title, l.visibility,
         l.allow_copy AS allowCopy, l.allow_comments AS allowComments
       FROM lists l JOIN users u ON u.id = l.owner_id
       WHERE l.id = ?1 AND (l.owner_id = ?2 OR (l.visibility = 'public' AND NOT ${blockedBetween('l.owner_id', '?2')}))`,
      [id, me])
    if (!l) throw new NotFoundException('Liste bulunamadı')
    const items = await q(this.db, 
      `SELECT p.id AS placeId, p.provider, p.provider_id AS providerId, p.name, p.lat, p.lon, i.category, i.note, i.position, i.details
       FROM list_items i JOIN places p ON p.id = i.place_id WHERE i.list_id = ? ORDER BY i.position`, [id])
    return {
      ...l, allowCopy: bool(l.allowCopy), allowComments: bool(l.allowComments),
      items: items.map((it: any) => ({ ...it, details: readStoredDetails(it.details) })),
    }
  }
}
