import { BadRequestException, Controller, Get, Headers, Injectable, Module, Query } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { UserId } from '../common/current-user.decorator'
import { blockedBetween, CATEGORIES, q, requestNow } from '../common/util'
import { buildHome, HOME_SQL, matchingCities, TEST_NOW_HEADER, toSignals, windowBounds } from './discover-core'

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

  /**
   * TRD: aggregates the 7-day window in SQL (HOME_SQL), then scores and ranks in discover-core.ts (identical copy of
   * backend/src/discover-core.ts). City match is case/diacritic-insensitive: stored spellings matching foldCity are
   * found first, then the query uses them (places.city index).
   */
  async home(rawCity: string | undefined, rawCategory: string | undefined, at: Date) {
    const city = rawCity?.trim() ?? ''
    if (!city || city.length > 100) throw new BadRequestException('city gerekli')
    const category = rawCategory?.trim() || null
    if (category !== null && !CATEGORIES.includes(category)) throw new BadRequestException('category geçersiz')
    const stored = await q(this.db, 'SELECT DISTINCT city FROM places WHERE city IS NOT NULL')
    const cities = matchingCities(city, stored.map((r: { city: string }) => r.city))
    if (!cities.length) return buildHome(city, [], category)
    const rows = await q(this.db, HOME_SQL, [JSON.stringify(cities), ...windowBounds(at)])
    return buildHome(city, rows.map(toSignals), category)
  }
}

@Controller('discover')
export class DiscoverController {
  constructor(private discover: DiscoverService) {}

  @Get('lists') lists(@UserId() me: number, @Query('city') city?: string) { return this.discover.list(me, city) }
  @Get('home') home(@Query('city') city?: string, @Query('category') category?: string, @Headers(TEST_NOW_HEADER) testNow?: string) {
    return this.discover.home(city, category, requestNow(testNow))
  }
}

@Module({ controllers: [DiscoverController], providers: [DiscoverService] })
export class DiscoverModule {}
