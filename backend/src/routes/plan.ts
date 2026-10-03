// Plan iyileştirmeleri (docs/ACCEPTANCE.md, PLN): yaya rotası ve açılış saatleri.
// src/index.ts bu uygulamayı oturum ara katmanından SONRA tek satırla bağlar (app.route('/', planRoutes)); böylece
// buradaki uçlar da oturum ister ve c.get('userId') doludur. Sağlayıcı mantığı src/plan-core.ts'te (NestJS ile birebir).
import { Hono, type Context } from 'hono'
import { resolveNow, TEST_NOW_HEADER } from '../discover-core'
import {
  parsePoints, PlanError, readHoursRow, resolveHours, SELECT_HOURS_SQL, UPSERT_HOURS_SQL, walkRoute, type PlanEnv,
} from '../plan-core'

type Env = PlanEnv & { DB: D1Database; E2E_TEST_HOOKS?: string }
type PlanAppEnv = { Bindings: Env; Variables: { userId: number } }
type C = Context<PlanAppEnv>

const planEnv = (e: Env): PlanEnv => ({
  ROUTING_PROVIDER: e.ROUTING_PROVIDER, HOURS_PROVIDER: e.HOURS_PROVIDER, SEARCH_PROVIDER: e.SEARCH_PROVIDER,
  GOOGLE_PLACES_API_KEY: e.GOOGLE_PLACES_API_KEY, GOOGLE_ROUTES_API_KEY: e.GOOGLE_ROUTES_API_KEY,
  ROUTING_URL: e.ROUTING_URL, OVERPASS_URL: e.OVERPASS_URL,
})
const outbound = (url: string, init?: RequestInit) => fetch(url, init)
const planError = (c: C, e: unknown) => {
  if (e instanceof PlanError) return c.json({ error: e.message }, e.status)
  throw e
}

export const planRoutes = new Hono<PlanAppEnv>()

// GET /routes/walk?points=lat,lon;lat,lon;... (2–25 nokta) -> {legs, totalDistanceM, totalDurationS, provider}
planRoutes.get('/routes/walk', async (c) => {
  try {
    const points = parsePoints(c.req.query('points'))
    return c.json(await walkRoute(planEnv(c.env), points, outbound))
  } catch (e) {
    return planError(c, e)
  }
})

// GET /places/:id/hours -> {openingHours, source, fetchedAt}; place_hours tablosunda 7 gün saklanır.
planRoutes.get('/places/:id/hours', async (c) => {
  const raw = c.req.param('id')
  if (!/^\d+$/.test(raw)) return c.json({ error: 'Yer bulunamadı' }, 404)
  const id = Number(raw)
  const db = c.env.DB
  const place = await db.prepare('SELECT provider, provider_id AS providerId FROM places WHERE id = ?1')
    .bind(id).first<{ provider: string; providerId: string }>()
  if (!place) return c.json({ error: 'Yer bulunamadı' }, 404)
  const cached = readHoursRow(await db.prepare(SELECT_HOURS_SQL).bind(id).first())
  const at = resolveNow(c.req.header(TEST_NOW_HEADER), c.env.E2E_TEST_HOOKS)
  try {
    const { response, store } = await resolveHours(planEnv(c.env), place, cached, at, outbound)
    if (store) await db.prepare(UPSERT_HOURS_SQL).bind(id, store.openingHours, store.source, store.fetchedAt).run()
    return c.json(response)
  } catch (e) {
    return planError(c, e)
  }
})
