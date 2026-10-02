import { INestApplication } from '@nestjs/common'
import { api, Client, createApp, register, RUN, uniq } from './helpers'

// Runs with SEARCH_PROVIDER=fake (test/setup-env.ts in-process; backend/scripts/start-e2e.mjs for the Worker):
// a fixed set of places in Roma, İstanbul and a few other cities, no outbound network.
const CATEGORIES = ['food', 'coffee', 'bar', 'historic', 'museum', 'park', 'beach', 'hotel', 'airport', 'other']
const ROMA = { lat: 41.9028, lon: 12.4964 }
const ISTANBUL = { lat: 41.0082, lon: 28.9784 }

describe('Place search', () => {
  let app: INestApplication
  let me: Client
  beforeAll(async () => {
    app = await createApp()
    me = await register(app, uniq('searcher'))
  })
  afterAll(async () => { await app.close() })

  it('AC-SRCH-1: a valid search returns results in the contract shape with mapped categories', async () => {
    const res = await me.get('/search/places?q=galata').expect(200)
    expect(res.body).toEqual([{
      provider: 'fake', providerId: 'fake-galata', name: 'Galata Kulesi',
      address: expect.stringContaining('İstanbul'), lat: 41.0256, lon: 28.9741, category: 'historic',
    }])
    // case- and diacritic-insensitive; matches address too; categories are always one of ours
    const ciya = await me.get(`/search/places?q=${encodeURIComponent('CIYA')}`).expect(200)
    expect(ciya.body.map((r: any) => [r.name, r.category])).toEqual([['Çiya Sofrası', 'food']])
    const roma = await me.get('/search/places?q=Roma').expect(200)
    expect(roma.body.length).toBeGreaterThan(1)
    expect(roma.body.length).toBeLessThanOrEqual(8)
    for (const r of roma.body) {
      expect(Object.keys(r).sort()).toEqual(['address', 'category', 'lat', 'lon', 'name', 'provider', 'providerId'])
      expect(CATEGORIES).toContain(r.category)
      expect(typeof r.lat).toBe('number')
      expect(typeof r.lon).toBe('number')
    }
    expect(new Set(roma.body.map((r: any) => r.category)).size).toBeGreaterThan(2)
    // no match -> empty list; the response never carries a provider key
    expect((await me.get('/search/places?q=zzzqqq').expect(200)).body).toEqual([])
    expect(JSON.stringify(roma.body)).not.toMatch(/key/i)
  })

  it('AC-SRCH-1: a saved search result keeps provider and providerId in the list detail', async () => {
    const [hit] = (await me.get('/search/places?q=colosseo').expect(200)).body
    const list = await me.post('/lists', { city: `Roma-SRCH-${RUN}`, title: 'From search' }).expect(201)
    const manual = { provider: 'voyage', providerId: `manual-${RUN}`, name: 'Manual', category: 'other' }
    await me.put(`/lists/${list.body.id}/items`, {
      items: [{ provider: hit.provider, providerId: hit.providerId, name: hit.name, lat: hit.lat, lon: hit.lon, category: hit.category }, manual],
    }).expect(200)
    const detail = (await me.get(`/lists/${list.body.id}`).expect(200)).body
    expect(detail.items[0]).toMatchObject({ provider: 'fake', providerId: 'fake-colosseo', name: 'Colosseo', category: 'historic', lat: 41.8902, lon: 12.4922 })
    expect(detail.items[1]).toMatchObject({ provider: 'voyage', providerId: `manual-${RUN}`, lat: null, lon: null })
  })

  it('AC-SRCH-2: q shorter than 2 characters gives 400; a request without a session gives 401', async () => {
    await me.get('/search/places').expect(400)
    await me.get('/search/places?q=a').expect(400)
    await me.get(`/search/places?q=${encodeURIComponent(' a ')}`).expect(400)
    const bad = await me.get('/search/places?q=').expect(400)
    expect(bad.body).toEqual({ error: expect.any(String) })
    // lat/lon must come together and be valid numbers
    await me.get('/search/places?q=roma&lat=41.9').expect(400)
    await me.get('/search/places?q=roma&lat=abc&lon=12').expect(400)
    await me.get('/search/places?q=roma&lat=91&lon=12').expect(400)

    await api(app).get('/search/places?q=galata').expect(401)
    await api(app).get('/search/places?q=galata').set('Authorization', 'Bearer nope').expect(401)
  })

  it('AC-SRCH-2: a provider failure gives 502 {error}', async () => {
    const res = await me.get('/search/places?q=__fail__').expect(502)
    expect(res.body).toEqual({ error: expect.any(String) })
  })

  it('AC-SRCH-3: with lat/lon the nearest result comes first', async () => {
    const nearRoma = (await me.get(`/search/places?q=hilton&lat=${ROMA.lat}&lon=${ROMA.lon}`).expect(200)).body
    expect(nearRoma.map((r: any) => r.name)).toEqual(['Hilton Rome Airport', 'Hilton İstanbul Bomonti'])
    const nearIst = (await me.get(`/search/places?q=hilton&lat=${ISTANBUL.lat}&lon=${ISTANBUL.lon}`).expect(200)).body
    expect(nearIst.map((r: any) => r.name)).toEqual(['Hilton İstanbul Bomonti', 'Hilton Rome Airport'])
    expect(nearIst.map((r: any) => r.category)).toEqual(['hotel', 'hotel'])

    // a query that matches places in several cities: sorted by distance, at most 8, nearest city first
    const rad = (x: number) => (x * Math.PI) / 180
    const d = (from: { lat: number; lon: number }, r: any) => Math.acos(Math.min(1,
      Math.sin(rad(from.lat)) * Math.sin(rad(r.lat)) + Math.cos(rad(from.lat)) * Math.cos(rad(r.lat)) * Math.cos(rad(r.lon - from.lon))))
    for (const [from, city] of [[ISTANBUL, 'İstanbul'], [ROMA, 'Roma']] as const) {
      const all = (await me.get(`/search/places?q=al&lat=${from.lat}&lon=${from.lon}`).expect(200)).body
      expect(all.length).toBe(8)
      expect(all[0].address).toContain(city)
      for (let i = 1; i < all.length; i++) expect(d(from, all[i])).toBeGreaterThanOrEqual(d(from, all[i - 1]) - 1e-9)
    }
  })
})
