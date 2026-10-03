import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Block, Follow, User } from '../database/entities'
import { blockedBetween, bool, now, q } from '../common/util'

@Injectable()
export class UsersService {
  constructor(private db: DataSource) {}

  async me(id: number) {
    const [u] = await q(this.db, 'SELECT id, handle, email FROM users WHERE id = ?', [id])
    return u
  }

  async deleteMe(id: number) {
    await this.db.getRepository(User).delete(id) // FK cascades remove everything else
    return { ok: true }
  }

  async search(me: number, term: string) {
    const prefix = (term ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (prefix.length < 2) return []
    const like = prefix.replace(/_/g, '\\_') + '%'
    const rows = await q(this.db, 
      `SELECT u.id, u.handle,
         EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ?1 AND f.followee_id = u.id) AS following,
         EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = ?1) AS followsMe
       FROM users u WHERE u.handle LIKE ?2 ESCAPE '\\' AND u.id != ?1 AND NOT ${blockedBetween('?1', 'u.id')}
       ORDER BY u.handle LIMIT 20`, [me, like])
    return rows.map((r: any) => ({ id: r.id, handle: r.handle, following: bool(r.following), followsMe: bool(r.followsMe) }))
  }

  async following(me: number) {
    const rows = await q(this.db, 
      `SELECT u.id, u.handle,
         EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = ?1) AS followsMe
       FROM follows o JOIN users u ON u.id = o.followee_id WHERE o.follower_id = ?1 ORDER BY u.handle`, [me])
    return rows.map((r: any) => ({ id: r.id, handle: r.handle, following: true, followsMe: bool(r.followsMe) }))
  }

  async follow(me: number, target: number) {
    if (target === me) throw new BadRequestException('Kendini takip edemezsin')
    const [ok] = await q(this.db, 
      `SELECT 1 AS ok FROM users u WHERE u.id = ?2 AND NOT ${blockedBetween('?1', 'u.id')}`, [me, target])
    if (!ok) throw new NotFoundException('Kullanıcı bulunamadı')
    await this.db.getRepository(Follow).upsert({ followerId: me, followeeId: target, createdAt: now() }, ['followerId', 'followeeId'])
    return { ok: true }
  }

  async unfollow(me: number, target: number) {
    await this.db.getRepository(Follow).delete({ followerId: me, followeeId: target })
    return { ok: true }
  }

  async block(me: number, target: number) {
    if (target === me) throw new BadRequestException('Kendini engelleyemezsin')
    if (!(await this.db.getRepository(User).exist({ where: { id: target } }))) throw new NotFoundException('Kullanıcı bulunamadı')
    await this.db.transaction(async (m) => {
      await m.getRepository(Block).upsert({ blockerId: me, blockedId: target }, ['blockerId', 'blockedId'])
      await q(m, 
        `DELETE FROM follows WHERE (follower_id = ?1 AND followee_id = ?2) OR (follower_id = ?2 AND followee_id = ?1)`, [me, target])
      // COL: a block also ends shared-list memberships between the two (either one's lists).
      await q(m,
        `DELETE FROM list_members WHERE (user_id = ?1 AND list_id IN (SELECT id FROM lists WHERE owner_id = ?2))
                                     OR (user_id = ?2 AND list_id IN (SELECT id FROM lists WHERE owner_id = ?1))`, [me, target])
    })
    return { ok: true }
  }

  async unblock(me: number, target: number) {
    await this.db.getRepository(Block).delete({ blockerId: me, blockedId: target })
    return { ok: true }
  }
}
