import { Controller, Get, Injectable, Module, Query } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { UserId } from '../common/current-user.decorator'
import { blockedBetween, q } from '../common/util'

@Injectable()
export class DiscoverService {
  constructor(private db: DataSource) {}

  list(me: number, city?: string) {
    const c = city?.trim() ? city.trim() : null
    return q(this.db, 
      `SELECT l.id, l.city, l.title, u.handle AS ownerHandle,
         (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS itemCount,
         (SELECT ROUND(AVG(r.stars), 1) FROM list_items i JOIN ratings r ON r.place_id = i.place_id
           WHERE i.list_id = l.id) AS avgStars
       FROM lists l JOIN users u ON u.id = l.owner_id
       WHERE l.visibility = 'public' AND (?2 IS NULL OR l.city = ?2 COLLATE NOCASE)
         AND NOT ${blockedBetween('l.owner_id', '?1')}
       ORDER BY itemCount DESC, l.updated_at DESC, l.id DESC LIMIT 30`, [me, c])
  }
}

@Controller('discover')
export class DiscoverController {
  constructor(private discover: DiscoverService) {}

  @Get('lists') lists(@UserId() me: number, @Query('city') city?: string) { return this.discover.list(me, city) }
}

@Module({ controllers: [DiscoverController], providers: [DiscoverService] })
export class DiscoverModule {}
