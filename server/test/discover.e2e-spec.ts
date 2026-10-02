import { INestApplication } from '@nestjs/common'
import { Client, createApp, item, listWithItems, register } from './helpers'

describe('Discover', () => {
  let app: INestApplication
  let owner: Client
  let viewer: Client
  beforeAll(async () => {
    app = await createApp()
    owner = await register(app, 'owner_d')
    viewer = await register(app, 'viewer_d')
  })
  afterAll(async () => { await app.close() })

  it('AC-DSC-1: only public lists are returned, filtered by city, at most 30', async () => {
    await listWithItems(owner, [item(1)], { city: 'Paris', visibility: 'public', title: 'Paris public' })
    await listWithItems(owner, [item(2)], { city: 'Paris', visibility: 'private', title: 'Paris private' })
    await listWithItems(owner, [item(3)], { city: 'Rome', visibility: 'public', title: 'Rome public' })

    const paris = (await viewer.get('/discover/lists?city=Paris').expect(200)).body
    expect(paris.map((l: any) => l.title)).toEqual(['Paris public'])
    expect(paris[0]).toEqual({ id: expect.any(Number), city: 'Paris', title: 'Paris public', ownerHandle: 'owner_d', itemCount: 1, avgStars: null })
    const all = (await viewer.get('/discover/lists').expect(200)).body
    expect(all.map((l: any) => l.title).sort()).toEqual(['Paris public', 'Rome public'])

    for (let i = 0; i < 31; i++) await listWithItems(owner, [], { city: 'Bulk', visibility: 'public', title: `Bulk ${i}` })
    expect((await viewer.get('/discover/lists?city=Bulk').expect(200)).body).toHaveLength(30)
    expect((await viewer.get('/discover/lists').expect(200)).body.length).toBeLessThanOrEqual(30)
  })

  it('AC-DSC-2: each result has itemCount and avgStars over its places (null without ratings)', async () => {
    const { id, placeIds } = await listWithItems(owner, [item(10), item(11)], { city: 'Avg', visibility: 'public' })
    let res = (await viewer.get('/discover/lists?city=Avg').expect(200)).body
    expect(res[0]).toMatchObject({ id, itemCount: 2, avgStars: null })
    await viewer.put(`/places/${placeIds[0]}/rating`, { stars: 5 }).expect(200)
    await owner.put(`/places/${placeIds[1]}/rating`, { stars: 4 }).expect(200)
    await owner.put(`/places/${placeIds[0]}/rating`, { stars: 3 }).expect(200)
    res = (await viewer.get('/discover/lists?city=Avg').expect(200)).body
    expect(res[0].avgStars).toBe(4) // ratings 5, 3, 4
  })

  it('AC-DSC-3: lists with more items come first', async () => {
    const small = await listWithItems(owner, [item(20)], { city: 'Order', visibility: 'public', title: 'small' })
    const big = await listWithItems(owner, [item(21), item(22), item(23)], { city: 'Order', visibility: 'public', title: 'big' })
    const mid = await listWithItems(owner, [item(24), item(25)], { city: 'Order', visibility: 'public', title: 'mid' })
    const res = (await viewer.get('/discover/lists?city=Order').expect(200)).body
    expect(res.map((l: any) => l.id)).toEqual([big.id, mid.id, small.id])
    expect(res.map((l: any) => l.itemCount)).toEqual([3, 2, 1])
  })
})
