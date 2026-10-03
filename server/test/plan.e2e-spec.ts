import { INestApplication } from '@nestjs/common'
import { api, Client, createApp, register, RUN, uniq } from './helpers'

// Runs with ROUTING_PROVIDER=fake and HOURS_PROVIDER=fake (test/setup-env.ts in-process; backend/scripts/start-e2e.mjs
// for the Worker): routes are straight line × 1.3 at 4.8 km/h; opening hours come from fixed texts by providerId prefix.
// The fake routing provider fails for the point 0,0 and the fake hours provider for ids containing "__fail__".

const COLOSSEO = { lat: 41.8902, lon: 12.4922 }
const ROSCIOLI = { lat: 41.8937, lon: 12.4731 }
const EUSTACHIO = { lat: 41.8986, lon: 12.4755 }
const PANTHEON = { lat: 41.8986, lon: 12.4769 }

/** Independent great-circle distance (m) to check the fake provider's numbers. */
function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}
const pts = (...ps: { lat: number; lon: number }[]) => encodeURIComponent(ps.map((p) => `${p.lat},${p.lon}`).join(';'))

describe('Plan improvements (PLN)', () => {
  let app: INestApplication
  let me: Client
  beforeAll(async () => {
    app = await createApp()
    me = await register(app, uniq('planner'))
  })
  afterAll(async () => { await app.close() })

  async function resolvePlace(providerId: string, name = 'Yer'): Promise<number> {
    const res = await me.post('/places/resolve', {
      provider: 'fake', providerId, name, lat: ROSCIOLI.lat, lon: ROSCIOLI.lon, category: 'food', city: 'Roma',
    }).expect(200)
    return res.body.placeId
  }

  it('AC-PLN-1: walking route returns legs and totals; bad point count/format 400; provider error 502', async () => {
    const two = await me.get(`/routes/walk?points=${pts(COLOSSEO, ROSCIOLI)}`).expect(200)
    expect(Object.keys(two.body).sort()).toEqual(['legs', 'provider', 'totalDistanceM', 'totalDurationS'])
    expect(two.body.provider).toBe('fake')
    expect(two.body.legs).toHaveLength(1)
    const expected = haversine(COLOSSEO, ROSCIOLI) * 1.3
    expect(Math.abs(two.body.legs[0].distanceM - expected)).toBeLessThanOrEqual(2)
    // 4.8 km/h = 1.333 m/s
    expect(Math.abs(two.body.legs[0].durationS - expected / (4800 / 3600))).toBeLessThanOrEqual(2)
    expect(Number.isInteger(two.body.legs[0].distanceM) && Number.isInteger(two.body.legs[0].durationS)).toBe(true)
    expect(two.body.totalDistanceM).toBe(two.body.legs[0].distanceM)
    expect(two.body.totalDurationS).toBe(two.body.legs[0].durationS)

    const four = await me.get(`/routes/walk?points=${pts(COLOSSEO, ROSCIOLI, EUSTACHIO, PANTHEON)}`).expect(200)
    expect(four.body.legs).toHaveLength(3)
    for (const l of four.body.legs) expect(Object.keys(l).sort()).toEqual(['distanceM', 'durationS'])
    expect(four.body.totalDistanceM).toBe(four.body.legs.reduce((s: number, l: any) => s + l.distanceM, 0))
    expect(four.body.totalDurationS).toBe(four.body.legs.reduce((s: number, l: any) => s + l.durationS, 0))
    expect(four.body.legs[0]).toEqual(two.body.legs[0])
    // spaces around separators are tolerated; 25 points is the maximum
    const max = Array.from({ length: 25 }, (_, i) => `${41.89 + i / 1000},${12.49}`).join(';')
    expect((await me.get(`/routes/walk?points=${encodeURIComponent(max)}`).expect(200)).body.legs).toHaveLength(24)

    const bad = [
      '', // missing
      `?points=${pts(COLOSSEO)}`, // one point
      `?points=${encodeURIComponent(Array.from({ length: 26 }, (_, i) => `41.${i},12.4`).join(';'))}`, // 26 points
      '?points=abc;def',
      `?points=${encodeURIComponent('41.89;12.49')}`,
      `?points=${encodeURIComponent('41.89,12.49;91,12.49')}`,
      `?points=${encodeURIComponent('41.89,12.49;41.9,181')}`,
      `?points=${encodeURIComponent('41.89,12.49;;41.9,12.5')}`,
      `?points=${encodeURIComponent('41.89,12.49,3;41.9,12.5')}`,
    ]
    for (const qs of bad) {
      const res = await me.get(`/routes/walk${qs}`)
      expect([qs, res.status]).toEqual([qs, 400])
      expect(typeof res.body.error).toBe('string')
    }
    const failed = await me.get(`/routes/walk?points=${pts(COLOSSEO, { lat: 0, lon: 0 })}`).expect(502)
    expect(typeof failed.body.error).toBe('string')
    await api(app).get(`/routes/walk?points=${pts(COLOSSEO, ROSCIOLI)}`).expect(401)
  })

  it('AC-PLN-2: opening hours are returned and cached for 7 days; unknown place 404; no hours -> null', async () => {
    const id = await resolvePlace(`fake-roscioli-${RUN}`, 'Roscioli')
    const t0 = '2026-03-02T10:00:00.000Z'
    const first = await me.get(`/places/${id}/hours`).set('X-Test-Now', t0).expect(200)
    expect(first.body).toEqual({ openingHours: 'Mo-Sa 12:30-16:00,19:00-23:00; Su off', source: 'fake', fetchedAt: t0 })
    // Second request (a day later): served from the cache, the provider is not asked (fetchedAt unchanged).
    const second = await me.get(`/places/${id}/hours`).set('X-Test-Now', '2026-03-03T10:00:00.000Z').expect(200)
    expect(second.body).toEqual(first.body)
    const sixDays = await me.get(`/places/${id}/hours`).set('X-Test-Now', '2026-03-08T09:59:00.000Z').expect(200)
    expect(sixDays.body.fetchedAt).toBe(t0)
    // After 7 days the provider is asked again.
    const t8 = '2026-03-10T10:00:00.000Z'
    const refreshed = await me.get(`/places/${id}/hours`).set('X-Test-Now', t8).expect(200)
    expect(refreshed.body).toEqual({ ...first.body, fetchedAt: t8 })
    // The cache is per place, shared by all users.
    const other = await register(app, uniq('planner2'))
    expect((await other.get(`/places/${id}/hours`).set('X-Test-Now', '2026-03-11T10:00:00.000Z').expect(200)).body.fetchedAt).toBe(t8)

    // 24/7 and overnight texts are passed through unchanged
    const villa = await resolvePlace(`fake-villa-borghese-${RUN}`, 'Villa Borghese')
    expect((await me.get(`/places/${villa}/hours`).expect(200)).body.openingHours).toBe('24/7')

    // A place without hours: null (also cached).
    const none = await resolvePlace(`fake-nohours-${RUN}`, 'Saatsiz')
    const n1 = await me.get(`/places/${none}/hours`).set('X-Test-Now', t0).expect(200)
    expect(n1.body).toEqual({ openingHours: null, source: 'fake', fetchedAt: t0 })
    expect((await me.get(`/places/${none}/hours`).set('X-Test-Now', '2026-03-04T10:00:00.000Z').expect(200)).body).toEqual(n1.body)

    // Manually added places (provider "voyage", only from lists) have no hours either.
    const created = await me.post('/lists', { city: 'Roma', title: `Saatler ${RUN}` }).expect(201)
    await me.put(`/lists/${created.body.id}/items`, { items: [{ provider: 'voyage', providerId: `v-${RUN}`, name: 'Ev' }] }).expect(200)
    const manual = (await me.get(`/lists/${created.body.id}`).expect(200)).body.items[0].placeId
    expect((await me.get(`/places/${manual}/hours`).expect(200)).body.openingHours).toBeNull()

    // Unknown place / non-numeric id 404; provider failure 502 (not cached); no session 401.
    expect((await me.get('/places/987654321/hours').expect(404)).body.error).toEqual(expect.any(String))
    await me.get('/places/abc/hours').expect(404)
    const failing = await resolvePlace(`fake-__fail__-${RUN}`, 'Hata')
    expect((await me.get(`/places/${failing}/hours`).expect(502)).body.error).toEqual(expect.any(String))
    await me.get(`/places/${failing}/hours`).expect(502)
    await api(app).get(`/places/${id}/hours`).expect(401)
  })
})
