import { INestApplication } from '@nestjs/common'
import { api, Client, createApp, register, RUN, uniq } from './helpers'

// Haritada dokunarak yer seçme (TAP). SEARCH_PROVIDER=fake: fikstürler içinden 300 m içindekiler, en yakından uzağa.
const COLOSSEO = { lat: 41.8902, lon: 12.4922 }
// Cervecería La Campana (40.4148, -3.7076) ile Café La Campana (40.4160, -3.7080) arası ~137 m.
const NEAR_CERVECERIA = { lat: 40.4150, lon: -3.7077 }
const NEAR_CAFE = { lat: 40.4159, lon: -3.7080 }

const rad = (x: number) => (x * Math.PI) / 180
const distM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => 6371000 * Math.acos(Math.min(1,
  Math.sin(rad(a.lat)) * Math.sin(rad(b.lat)) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon))))

describe('Tap on the map (TAP)', () => {
  let app: INestApplication
  let me: Client
  let other: Client
  beforeAll(async () => {
    app = await createApp()
    me = await register(app, uniq('tapper'))
    other = await register(app, uniq('tapper2'))
  })
  afterAll(async () => { await app.close() })

  it('AC-TAP-1: /search/nearby returns nearby places nearest first, in the /search/places shape', async () => {
    const near = (await me.get(`/search/nearby?lat=${NEAR_CERVECERIA.lat}&lon=${NEAR_CERVECERIA.lon}&lang=tr`).expect(200)).body
    expect(near.map((r: any) => r.providerId)).toEqual(['fake-la-campana', 'fake-campana-cafe'])
    expect(near[0]).toEqual({
      provider: 'fake', providerId: 'fake-la-campana', name: 'Cervecería La Campana',
      address: expect.stringContaining('Madrid'), lat: 40.4148, lon: -3.7076, category: 'food',
    })
    for (const r of near) {
      expect(Object.keys(r).sort()).toEqual(['address', 'category', 'lat', 'lon', 'name', 'provider', 'providerId'])
      expect(r.name).toBeTruthy()
    }
    // the order follows the tapped point
    const other = (await me.get(`/search/nearby?lat=${NEAR_CAFE.lat}&lon=${NEAR_CAFE.lon}`).expect(200)).body
    expect(other.map((r: any) => r.providerId)).toEqual(['fake-campana-cafe', 'fake-la-campana'])
    for (let i = 1; i < other.length; i++) expect(distM(NEAR_CAFE, other[i])).toBeGreaterThanOrEqual(distM(NEAR_CAFE, other[i - 1]))

    const colosseo = (await me.get(`/search/nearby?lat=${COLOSSEO.lat + 0.0003}&lon=${COLOSSEO.lon + 0.0003}`).expect(200)).body
    expect(colosseo.map((r: any) => r.name)).toEqual(['Colosseo'])
  })

  it('AC-TAP-1: far-away places do not come back; nothing nearby gives []', async () => {
    // ~830 m east of the Colosseo: outside the radius
    expect((await me.get(`/search/nearby?lat=${COLOSSEO.lat}&lon=${COLOSSEO.lon + 0.01}`).expect(200)).body).toEqual([])
    // the middle of the sea
    expect((await me.get('/search/nearby?lat=0&lon=0').expect(200)).body).toEqual([])
    // Roscioli and Sant'Eustachio are ~560 m apart: a tap next to one never returns the other
    const roscioli = (await me.get('/search/nearby?lat=41.8936&lon=12.4732').expect(200)).body
    expect(roscioli.map((r: any) => r.providerId)).toEqual(['fake-roscioli'])
    for (const r of roscioli) expect(distM({ lat: 41.8936, lon: 12.4732 }, r)).toBeLessThanOrEqual(300)
  })

  it('AC-TAP-1: missing/invalid lat-lon gives 400 {error}; a request without a session gives 401', async () => {
    await me.get('/search/nearby').expect(400)
    await me.get('/search/nearby?lat=41.9').expect(400)
    await me.get('/search/nearby?lat=abc&lon=12').expect(400)
    await me.get('/search/nearby?lat=91&lon=12').expect(400)
    const bad = await me.get('/search/nearby?lat=41&lon=181').expect(400)
    expect(bad.body).toEqual({ error: expect.any(String) })
    // an invalid language is ignored
    await me.get(`/search/nearby?lat=${COLOSSEO.lat}&lon=${COLOSSEO.lon}&lang=__`).expect(200)
    await api(app).get(`/search/nearby?lat=${COLOSSEO.lat}&lon=${COLOSSEO.lon}`).expect(401)
  })

  const tapped = () => ({
    provider: 'osm', providerId: `N${RUN}1`, name: `Trattoria ${RUN}`, lat: 41.8931, lon: 12.4828, category: 'food', city: 'Roma',
  })

  it('AC-TAP-2: /places/resolve returns the same placeId for the same identity; rating, comments and GET /places/:id work', async () => {
    const first = await me.post('/places/resolve', tapped()).expect(200)
    expect(first.body).toEqual({ placeId: expect.any(Number) })
    const id = first.body.placeId
    // same identity (by another user, with a different name) -> same place
    expect((await other.post('/places/resolve', { ...tapped(), name: 'Renamed' }).expect(200)).body).toEqual({ placeId: id })
    expect((await me.post('/places/resolve', tapped()).expect(200)).body).toEqual({ placeId: id })

    const place = (await me.get(`/places/${id}`).expect(200)).body
    expect(place.place).toEqual({ id, name: `Trattoria ${RUN}`, lat: 41.8931, lon: 12.4828, category: 'food', city: 'Roma' })
    expect(place.rating).toMatchObject({ count: 0, avg: null, mine: null })

    await me.put(`/places/${id}/rating`, { stars: 5 }).expect(200)
    await other.put(`/places/${id}/rating`, { stars: 4 }).expect(200)
    expect((await me.get(`/places/${id}`).expect(200)).body.rating).toMatchObject({ count: 2, avg: 4.5, mine: 5 })

    const c = await other.post(`/places/${id}/comments`, { body: 'Carbonara harika' }).expect(201)
    const comments = (await me.get(`/places/${id}/comments`).expect(200)).body
    expect(comments).toEqual([expect.objectContaining({ id: c.body.id, body: 'Carbonara harika', author: other.handle, photos: [] })])
  })

  it('AC-TAP-2: a place saved in a list resolves to the same placeId (and back); unknown category becomes other; city is filled in', async () => {
    const pid = `fake-tap-${RUN}`
    const created = (await me.post('/places/resolve', {
      provider: 'fake', providerId: pid, name: 'Bar X', lat: 41.9, lon: 12.5, category: 'spaceship',
    }).expect(200)).body.placeId
    let place = (await me.get(`/places/${created}`).expect(200)).body.place
    expect(place).toMatchObject({ category: 'other', city: null })
    // a later resolve with a city fills it in, the id stays the same
    expect((await me.post('/places/resolve', {
      provider: 'fake', providerId: pid, name: 'Bar X', lat: 41.9, lon: 12.5, category: 'bar', city: `Roma-TAP-${RUN}`,
    }).expect(200)).body).toEqual({ placeId: created })
    place = (await me.get(`/places/${created}`).expect(200)).body.place
    expect(place.city).toBe(`Roma-TAP-${RUN}`)

    const list = (await me.post('/lists', { city: `Roma-TAP-${RUN}`, title: 'Tap list' }).expect(201)).body.id
    await me.put(`/lists/${list}/items`, {
      items: [{ provider: 'fake', providerId: pid, name: 'Bar X', lat: 41.9, lon: 12.5, category: 'bar' },
        { provider: 'fake', providerId: `${pid}-b`, name: 'Bar Y', lat: 41.91, lon: 12.51, category: 'bar' }],
    }).expect(200)
    const items = (await me.get(`/lists/${list}`).expect(200)).body.items
    expect(items[0].placeId).toBe(created)
    expect((await me.post('/places/resolve', {
      provider: 'fake', providerId: `${pid}-b`, name: 'Bar Y', lat: 41.91, lon: 12.51, category: 'bar',
    }).expect(200)).body).toEqual({ placeId: items[1].placeId })
  })

  it('AC-TAP-2: provider voyage, missing or invalid fields give 400 {error}; no session gives 401', async () => {
    const ok = tapped()
    const voyage = await me.post('/places/resolve', { ...ok, provider: 'voyage' }).expect(400)
    expect(voyage.body).toEqual({ error: expect.any(String) })
    const bad: object[] = [
      {},
      { ...ok, provider: '' },
      { ...ok, providerId: undefined },
      { ...ok, name: '   ' },
      { ...ok, lat: undefined },
      { ...ok, lat: '41.9' },
      { ...ok, lon: 200 },
      { ...ok, category: undefined },
      { ...ok, city: 5 },
    ]
    for (const b of bad) await me.post('/places/resolve', b).expect(400)
    await api(app).post('/places/resolve').send(ok).expect(401)
  })
})
