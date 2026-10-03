import { Controller, Get, Headers, HttpException, Injectable, Module, NotFoundException, OnModuleInit, Param, Query } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { q, requestNow } from '../common/util'
import { TEST_NOW_HEADER } from '../discover/discover-core'
import {
  parsePoints, PLACE_HOURS_DDL, PlanError, readHoursRow, resolveHours, SELECT_HOURS_SQL, UPSERT_HOURS_SQL, walkRoute,
  type FetchLike, type PlanEnv,
} from './plan-core'

// Plan improvements (docs/ACCEPTANCE.md, PLN): GET /routes/walk and GET /places/:id/hours.
// Provider logic lives in plan-core.ts (byte-identical to backend/src/plan-core.ts).

const env = (): PlanEnv => ({
  ROUTING_PROVIDER: process.env.ROUTING_PROVIDER, HOURS_PROVIDER: process.env.HOURS_PROVIDER,
  SEARCH_PROVIDER: process.env.SEARCH_PROVIDER, GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
  GOOGLE_ROUTES_API_KEY: process.env.GOOGLE_ROUTES_API_KEY, ROUTING_URL: process.env.ROUTING_URL,
  OVERPASS_URL: process.env.OVERPASS_URL,
})
const outbound = fetch as unknown as FetchLike

function http<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e instanceof PlanError) throw new HttpException(e.message, e.status)
    throw e
  })
}

@Injectable()
export class PlanService implements OnModuleInit {
  constructor(private db: DataSource) {}

  /** The hours cache is not a TypeORM entity: same DDL as the Worker migration 0008 (minus the FK). */
  async onModuleInit() { await this.db.query(PLACE_HOURS_DDL) }

  walk(points: unknown) {
    return http((async () => walkRoute(env(), parsePoints(points), outbound))())
  }

  async hours(id: number, at: Date) {
    const [place] = await q(this.db, 'SELECT provider, provider_id AS providerId FROM places WHERE id = ?1', [id])
    if (!place) throw new NotFoundException('Yer bulunamadı')
    const [row] = await q(this.db, SELECT_HOURS_SQL, [id])
    const { response, store } = await http(resolveHours(env(), place, readHoursRow(row), at, outbound))
    if (store) await q(this.db, UPSERT_HOURS_SQL, [id, store.openingHours, store.source, store.fetchedAt])
    return response
  }
}

@Controller()
export class PlanController {
  constructor(private plan: PlanService) {}

  /** GET /routes/walk?points=lat,lon;lat,lon;... (2–25) -> {legs, totalDistanceM, totalDurationS, provider} */
  @Get('routes/walk') walk(@Query('points') points: unknown) { return this.plan.walk(points) }

  /** GET /places/:id/hours -> {openingHours, source, fetchedAt}; cached 7 days per place. */
  @Get('places/:id/hours') hours(@Param('id') id: string, @Headers(TEST_NOW_HEADER) testNow?: string) {
    if (!/^\d+$/.test(id)) throw new NotFoundException('Yer bulunamadı')
    return this.plan.hours(Number(id), requestNow(testNow))
  }
}

@Module({ controllers: [PlanController], providers: [PlanService] })
export class PlanModule {}
