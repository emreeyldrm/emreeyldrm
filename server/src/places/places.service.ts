import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Comment, Place, Rating } from '../database/entities'
import { blockedBetween, now, q } from '../common/util'
import { CreateCommentDto } from './places.dto'
import { DetailsError, parseCommentInput, readStoredPhotos } from '../lists/details-core'
import { requireOwnMedia } from '../media/media'

@Injectable()
export class PlacesService {
  constructor(private db: DataSource) {}

  private async requirePlace(id: number) {
    if (!(await this.db.getRepository(Place).exist({ where: { id } }))) throw new NotFoundException('Yer bulunamadı')
  }

  async get(me: number, id: number) {
    const [place] = await q(this.db, 'SELECT id, name, lat, lon, category, city FROM places WHERE id = ?', [id])
    if (!place) throw new NotFoundException('Yer bulunamadı')
    const [stats] = await q(this.db, 
      'SELECT COUNT(*) AS count, ROUND(AVG(stars), 1) AS avg FROM ratings WHERE place_id = ?', [id])
    const dist = await q(this.db, 'SELECT stars, COUNT(*) AS n FROM ratings WHERE place_id = ? GROUP BY stars', [id])
    const distribution = [1, 2, 3, 4, 5].map((s) => ({ stars: s, n: dist.find((d: any) => d.stars === s)?.n ?? 0 }))
    const [mine] = await q(this.db, 'SELECT stars FROM ratings WHERE place_id = ? AND user_id = ?', [id, me])
    return { place, rating: { count: stats.count, avg: stats.avg ?? null, distribution, mine: mine?.stars ?? null } }
  }

  async rate(me: number, id: number, stars: number) {
    await this.requirePlace(id)
    await this.db.getRepository(Rating).upsert({ placeId: id, userId: me, stars, updatedAt: now() }, ['placeId', 'userId'])
    return { ok: true }
  }

  // Own comments are always visible. Others': not blocked either way, and public, or friends with mutual follow.
  async comments(me: number, id: number) {
    await this.requirePlace(id)
    const rows = await q(this.db, 
      `SELECT c.id, c.parent_id AS parentId, c.body, c.visibility, c.created_at AS createdAt,
         c.user_id AS authorId, u.handle AS author, c.photos
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.place_id = ?1 AND c.hidden = 0
         AND (c.user_id = ?2 OR (
           NOT ${blockedBetween('c.user_id', '?2')}
           AND (c.visibility = 'public' OR (c.visibility = 'friends' AND EXISTS (
             SELECT 1 FROM follows a JOIN follows f ON f.follower_id = a.followee_id AND f.followee_id = a.follower_id
             WHERE a.follower_id = ?2 AND a.followee_id = c.user_id)))))
       ORDER BY c.created_at DESC, c.id DESC LIMIT 100`, [id, me])
    return rows.map((r: any) => ({ ...r, photos: readStoredPhotos(r.photos) }))
  }

  async addComment(me: number, id: number, dto: CreateCommentDto) {
    let input: { body: string; photos: string[] }
    try { input = parseCommentInput(dto.body, dto.photos) } catch (e) {
      if (e instanceof DetailsError) throw new BadRequestException(e.message)
      throw e
    }
    const cutoff = new Date(Date.now() - 60_000).toISOString()
    const [recent] = await q(this.db, 'SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > ?', [me, cutoff])
    if (recent.n >= 5) throw new HttpException('Çok hızlısın, biraz bekle', HttpStatus.TOO_MANY_REQUESTS)
    await this.requirePlace(id)
    if (dto.parentId != null &&
      !(await this.db.getRepository(Comment).exist({ where: { id: dto.parentId, placeId: id } })))
      throw new BadRequestException('parentId geçersiz')
    await requireOwnMedia(this.db, me, input.photos)
    const c = await this.db.getRepository(Comment).save({
      placeId: id, userId: me, parentId: dto.parentId ?? null, body: input.body, photos: JSON.stringify(input.photos),
      visibility: dto.visibility ?? 'public', hidden: false, createdAt: now(),
    })
    return { id: c.id }
  }

  async deleteComment(me: number, id: number) {
    const r = await this.db.getRepository(Comment).delete({ id, userId: me })
    if (!r.affected) throw new NotFoundException('Yorum bulunamadı')
    return { ok: true }
  }
}
