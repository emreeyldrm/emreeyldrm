import { INestApplication } from '@nestjs/common'
import { Client, createApp, item, listWithItems, register } from './helpers'

describe('Ratings', () => {
  let app: INestApplication
  let a: Client
  let b: Client
  let placeId: number
  beforeAll(async () => {
    app = await createApp()
    a = await register(app, 'rater_a')
    b = await register(app, 'rater_b')
    placeId = (await listWithItems(a, [item(1, { category: 'coffee', city: 'Izmir' })])).placeIds[0]
  })
  afterAll(async () => { await app.close() })

  it('AC-RTG-1: integer 1-5 ratings are stored; place returns avg, count, distribution and mine', async () => {
    let res = (await a.get(`/places/${placeId}`).expect(200)).body
    expect(res.place).toEqual({ id: placeId, name: 'Place 1', lat: expect.any(Number), lon: expect.any(Number), category: 'coffee', city: 'Izmir' })
    expect(res.rating).toMatchObject({ count: 0, avg: null, mine: null })

    await a.put(`/places/${placeId}/rating`, { stars: 5 }).expect(200).expect({ ok: true })
    await b.put(`/places/${placeId}/rating`, { stars: 4 }).expect(200)
    res = (await a.get(`/places/${placeId}`).expect(200)).body
    expect(res.rating.count).toBe(2)
    expect(res.rating.avg).toBe(4.5)
    expect(res.rating.mine).toBe(5)
    expect(res.rating.distribution.filter((d: any) => d.n > 0)).toEqual([{ stars: 4, n: 1 }, { stars: 5, n: 1 }])
    expect((await b.get(`/places/${placeId}`).expect(200)).body.rating.mine).toBe(4)
  })

  it('AC-RTG-2: rating again replaces the previous rating without increasing the count', async () => {
    const c = await register(app, 'rater_c')
    await c.put(`/places/${placeId}/rating`, { stars: 1 }).expect(200)
    const before = (await c.get(`/places/${placeId}`).expect(200)).body.rating
    await c.put(`/places/${placeId}/rating`, { stars: 3 }).expect(200)
    const after = (await c.get(`/places/${placeId}`).expect(200)).body.rating
    expect(after.count).toBe(before.count)
    expect(after.mine).toBe(3)
    expect(after.distribution.find((d: any) => d.stars === 1).n).toBe(0)
    expect(after.distribution.find((d: any) => d.stars === 3).n).toBe(1)
  })

  it('AC-RTG-3: 0, 6, 3.5 or text give 400; a missing place gives 404', async () => {
    for (const stars of [0, 6, 3.5, 'abc', '4', null, -1]) {
      const res = await a.put(`/places/${placeId}/rating`, { stars } as any).expect(400)
      expect(res.body).toEqual({ error: expect.any(String) })
    }
    await a.put(`/places/${placeId}/rating`, {}).expect(400)
    await a.put('/places/999999/rating', { stars: 3 }).expect(404)
    await a.get('/places/999999').expect(404)
    expect((await a.get(`/places/${placeId}`).expect(200)).body.rating.mine).toBe(5)
  })
})
