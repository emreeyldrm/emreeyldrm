import { INestApplication } from '@nestjs/common'
import { API_URL, Client, createApp, item, listWithItems, register, RUN, uniq } from './helpers'

describe('Discover', () => {
  let app: INestApplication
  let owner: Client
  let viewer: Client
  beforeAll(async () => {
    app = await createApp()
    owner = await register(app, uniq('owner_d'))
    viewer = await register(app, uniq('viewer_d'))
  })
  afterAll(async () => { await app.close() })

  it('AC-DSC-1: only public lists are returned, filtered by city, at most 30', async () => {
    const [paris, rome, bulk] = [`Paris-${RUN}`, `Rome-${RUN}`, `Bulk-${RUN}`]
    await listWithItems(owner, [item(1)], { city: paris, visibility: 'public', title: 'Paris public' })
    const priv = await listWithItems(owner, [item(2)], { city: paris, visibility: 'private', title: 'Paris private' })
    await listWithItems(owner, [item(3)], { city: rome, visibility: 'public', title: 'Rome public' })

    const inParis = (await viewer.get(`/discover/lists?city=${paris}`).expect(200)).body
    expect(inParis.map((l: any) => l.title)).toEqual(['Paris public'])
    expect(inParis[0]).toEqual({ id: expect.any(Number), city: paris, title: 'Paris public', ownerHandle: owner.handle, itemCount: 1, avgStars: null })
    const all = (await viewer.get('/discover/lists').expect(200)).body
    if (!API_URL) expect(all.map((l: any) => l.title).sort()).toEqual(['Paris public', 'Rome public'])
    else expect(all.map((l: any) => l.id)).not.toContain(priv.id) // shared database: other files' lists show up too

    for (let i = 0; i < 31; i++) await listWithItems(owner, [], { city: bulk, visibility: 'public', title: `Bulk ${i}` })
    expect((await viewer.get(`/discover/lists?city=${bulk}`).expect(200)).body).toHaveLength(30)
    expect((await viewer.get('/discover/lists').expect(200)).body.length).toBeLessThanOrEqual(30)
  })

  it('AC-DSC-2: each result has itemCount and avgStars over its places (null without ratings)', async () => {
    const { id, placeIds } = await listWithItems(owner, [item(10), item(11)], { city: `Avg-${RUN}`, visibility: 'public' })
    let res = (await viewer.get(`/discover/lists?city=Avg-${RUN}`).expect(200)).body
    expect(res[0]).toMatchObject({ id, itemCount: 2, avgStars: null })
    await viewer.put(`/places/${placeIds[0]}/rating`, { stars: 5 }).expect(200)
    await owner.put(`/places/${placeIds[1]}/rating`, { stars: 4 }).expect(200)
    await owner.put(`/places/${placeIds[0]}/rating`, { stars: 3 }).expect(200)
    res = (await viewer.get(`/discover/lists?city=Avg-${RUN}`).expect(200)).body
    expect(res[0].avgStars).toBe(4) // ratings 5, 3, 4
  })

  it('AC-DSC-3: lists with more items come first', async () => {
    const city = `Order-${RUN}`
    const small = await listWithItems(owner, [item(20)], { city, visibility: 'public', title: 'small' })
    const big = await listWithItems(owner, [item(21), item(22), item(23)], { city, visibility: 'public', title: 'big' })
    const mid = await listWithItems(owner, [item(24), item(25)], { city, visibility: 'public', title: 'mid' })
    const res = (await viewer.get(`/discover/lists?city=${city}`).expect(200)).body
    expect(res.map((l: any) => l.id)).toEqual([big.id, mid.id, small.id])
    expect(res.map((l: any) => l.itemCount)).toEqual([3, 2, 1])
  })
})
