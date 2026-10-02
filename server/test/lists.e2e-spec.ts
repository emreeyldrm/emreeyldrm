import { INestApplication } from '@nestjs/common'
import { Client, createApp, item, listWithItems, register, RUN, uniq } from './helpers'

describe('Lists', () => {
  let app: INestApplication
  let owner: Client
  let other: Client
  beforeAll(async () => {
    app = await createApp()
    owner = await register(app, uniq('owner_l'))
    other = await register(app, uniq('other_l'))
  })
  afterAll(async () => { await app.close() })

  it('AC-LST-1: a new list is private by default and shows up in /lists/mine', async () => {
    const created = await owner.post('/lists', { city: 'Istanbul', title: 'Defaults' }).expect(201)
    expect(created.body).toEqual({ id: expect.any(Number) })
    const mine = await owner.get('/lists/mine').expect(200)
    const l = mine.body.find((x: any) => x.id === created.body.id)
    expect(l).toEqual({
      id: created.body.id, city: 'Istanbul', title: 'Defaults', visibility: 'private',
      allowCopy: true, allowComments: true, itemCount: 0, updatedAt: expect.any(String),
    })
    expect(Number.isNaN(Date.parse(l.updatedAt))).toBe(false)
    expect((await other.get('/lists/mine').expect(200)).body).toEqual([])
    await owner.post('/lists', { city: '', title: 'x' }).expect(400)
    await owner.post('/lists', { city: 'Rome' }).expect(400)
  })

  it('AC-LST-2: a private list is hidden from everyone but the owner (404)', async () => {
    const { id } = await listWithItems(owner, [item(1)], { title: 'Secret' })
    await other.get(`/lists/${id}`).expect(404)
    const res = await owner.get(`/lists/${id}`).expect(200)
    expect(res.body).toMatchObject({ id, ownerHandle: owner.handle, visibility: 'private', title: 'Secret', city: 'Istanbul' })
    expect(res.body.ownerId).toBe(owner.id)
    await other.get('/lists/999999').expect(404)
  })

  it('AC-LST-3: public lists are visible and discoverable; private again hides them from both', async () => {
    const { id } = await listWithItems(owner, [item(1)], { city: `Lisbon-LST3-${RUN}`, title: 'Toggle' })
    await other.patch(`/lists/${id}`, { visibility: 'public' }).expect(404)
    await owner.patch(`/lists/${id}`, { visibility: 'public' }).expect(200).expect({ ok: true })
    const seen = await other.get(`/lists/${id}`).expect(200)
    expect(seen.body.items).toHaveLength(1)
    let discover = await other.get(`/discover/lists?city=Lisbon-LST3-${RUN}`).expect(200)
    expect(discover.body.map((l: any) => l.id)).toEqual([id])
    await owner.patch(`/lists/${id}`, { visibility: 'private' }).expect(200)
    await other.get(`/lists/${id}`).expect(404)
    discover = await other.get(`/discover/lists?city=Lisbon-LST3-${RUN}`).expect(200)
    expect(discover.body).toEqual([])
  })

  it('AC-LST-4: the owner updates title, visibility, allowCopy and allowComments; others get 404', async () => {
    const { id } = await listWithItems(owner, [item(1)])
    await owner.patch(`/lists/${id}`, { title: 'Renamed', visibility: 'public', allowCopy: false, allowComments: false }).expect(200)
    const l = (await owner.get('/lists/mine').expect(200)).body.find((x: any) => x.id === id)
    expect(l).toMatchObject({ title: 'Renamed', visibility: 'public', allowCopy: false, allowComments: false })
    const detail = (await other.get(`/lists/${id}`).expect(200)).body
    expect(detail).toMatchObject({ allowCopy: false, allowComments: false })
    await other.patch(`/lists/${id}`, { title: 'Hacked' }).expect(404)
    await owner.patch(`/lists/${id}`, { visibility: 'bogus' }).expect(400)
    expect((await owner.get(`/lists/${id}`).expect(200)).body.title).toBe('Renamed')
  })

  it('AC-LST-5: PUT items replaces everything, keeps order, and shares one place row across lists', async () => {
    const a = await listWithItems(owner, [item(1), item(2), item(3)], { title: 'A' })
    const b = await listWithItems(other, [item(3), item(1)], { title: 'B' })
    // same (provider, providerId) -> same place id in both lists
    expect(b.placeIds).toEqual([a.placeIds[2], a.placeIds[0]])

    const res = await owner.put(`/lists/${a.id}/items`, { items: [item(3, { note: 'n3' }), item(4), item(1)] }).expect(200)
    expect(res.body).toEqual({ ok: true, count: 3 })
    const detail = (await owner.get(`/lists/${a.id}`).expect(200)).body
    expect(detail.items.map((i: any) => i.name)).toEqual(['Place 3', 'Place 4', 'Place 1'])
    expect(detail.items.map((i: any) => i.position)).toEqual([0, 1, 2])
    expect(detail.items[0]).toEqual({
      placeId: a.placeIds[2], name: 'Place 3', lat: expect.any(Number), lon: expect.any(Number),
      category: 'food', note: 'n3', position: 0,
    })
    await other.put(`/lists/${a.id}/items`, { items: [] }).expect(404)
    await owner.put(`/lists/${a.id}/items`, { items: [] }).expect(200).expect({ ok: true, count: 0 })
    expect((await owner.get(`/lists/${a.id}`).expect(200)).body.items).toEqual([])
    expect((await other.get(`/lists/${b.id}`).expect(200)).body.items).toHaveLength(2)
  })

  it('AC-LST-6: more than 500 items gives 400; unknown category falls back to other; missing fields give 400', async () => {
    const { id } = await listWithItems(owner, [])
    const many = Array.from({ length: 501 }, (_, i) => item(i))
    const big = await owner.put(`/lists/${id}/items`, { items: many }).expect(400)
    expect(big.body).toEqual({ error: expect.any(String) })
    const max = Array.from({ length: 500 }, (_, i) => item(1000 + i))
    await owner.put(`/lists/${id}/items`, { items: max }).expect(200).expect({ ok: true, count: 500 })

    await owner.put(`/lists/${id}/items`, { items: [item(1, { category: 'spaceship' }), { provider: 'apple', providerId: 'min', name: 'Minimal' }] }).expect(200)
    const detail = (await owner.get(`/lists/${id}`).expect(200)).body
    expect(detail.items.map((i: any) => i.category)).toEqual(['other', 'other'])
    expect(detail.items[1]).toMatchObject({ name: 'Minimal', lat: null, lon: null, note: '' })

    await owner.put(`/lists/${id}/items`, { items: [{ provider: 'apple', name: 'no pid' }] }).expect(400)
    await owner.put(`/lists/${id}/items`, { items: [{ providerId: 'x', name: 'no provider' }] }).expect(400)
    await owner.put(`/lists/${id}/items`, { items: [{ provider: 'apple', providerId: 'x' }] }).expect(400)
    await owner.put(`/lists/${id}/items`, {}).expect(400)
    await owner.put(`/lists/${id}/items`, { items: 'nope' }).expect(400)
    // a failed replace leaves the previous content untouched
    expect((await owner.get(`/lists/${id}`).expect(200)).body.items).toHaveLength(2)
  })

  it('AC-LST-7: deleting a list removes its items; others cannot delete it (404)', async () => {
    const { id, placeIds } = await listWithItems(owner, [item(1), item(2)], { visibility: 'public' })
    await other.del(`/lists/${id}`).expect(404)
    await owner.get(`/lists/${id}`).expect(200)
    await owner.del(`/lists/${id}`).expect(200).expect({ ok: true })
    await owner.get(`/lists/${id}`).expect(404)
    expect((await owner.get('/lists/mine').expect(200)).body.find((l: any) => l.id === id)).toBeUndefined()
    await owner.del(`/lists/${id}`).expect(404)
    // the places themselves survive
    await owner.get(`/places/${placeIds[0]}`).expect(200)
  })

  it('AC-LST-8: a block between owner and viewer hides a public list (404) and removes it from Discover', async () => {
    const city = `Berlin-LST8-${RUN}`
    const { id } = await listWithItems(owner, [item(1)], { city, visibility: 'public' })
    await other.get(`/lists/${id}`).expect(200)
    expect((await other.get(`/discover/lists?city=${city}`).expect(200)).body).toHaveLength(1)

    // viewer blocks owner
    await other.post(`/blocks/${owner.id}`).expect(200)
    await other.get(`/lists/${id}`).expect(404)
    expect((await other.get(`/discover/lists?city=${city}`).expect(200)).body).toEqual([])
    await other.del(`/blocks/${owner.id}`).expect(200)
    await other.get(`/lists/${id}`).expect(200)

    // owner blocks viewer
    await owner.post(`/blocks/${other.id}`).expect(200)
    await other.get(`/lists/${id}`).expect(404)
    expect((await other.get(`/discover/lists?city=${city}`).expect(200)).body).toEqual([])
    await owner.get(`/lists/${id}`).expect(200)
    await owner.del(`/blocks/${other.id}`).expect(200)
  })
})
