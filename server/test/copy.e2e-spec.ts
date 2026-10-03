import { INestApplication } from '@nestjs/common'
import { api, Client, createApp, item, listWithItems, mutualFollow, register, RUN } from './helpers'

/** CPY: POST /lists/:id/copy (docs/ACCEPTANCE.md, "Kopyalama"). In-process and against the Worker (shared database). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

let n = 5000
const place = (extra: object = {}) => item(++n, extra)

describe('List copy (CPY)', () => {
  let app: INestApplication
  let owner: Client
  let other: Client
  const upload = async (c: Client) =>
    (await api(app).post('/media').set('Content-Type', 'image/png').set('Authorization', `Bearer ${c.token}`).send(PNG).expect(201)).body.id as string

  beforeAll(async () => {
    app = await createApp()
    owner = await register(app)
    other = await register(app)
  })
  afterAll(async () => { await app.close() })

  it('AC-CPY-1: anyone copies a public list with allowCopy; the copy is private, titled "(kopya)", items without photos', async () => {
    const photo = await upload(owner)
    const items = [
      place({ category: 'museum', note: 'Sabah git', details: { photos: [photo], spendPerPerson: 20, currency: 'EUR', favorites: ['Tavan'] } }),
      place({ category: 'food', note: '' }),
      place({ category: 'bogus', note: 'n3', details: { googleMapsUrl: 'https://maps.app.goo.gl/x' } }),
    ]
    const { id } = await listWithItems(owner, items, { city: 'Roma', title: 'Roma klasikleri', visibility: 'public' })
    const created = await other.post(`/lists/${id}/copy`).expect(201)
    expect(created.body).toEqual({ id: expect.any(Number) })
    const copyId = created.body.id
    expect(copyId).not.toBe(id)

    const src = (await owner.get(`/lists/${id}`).expect(200)).body
    const copy = (await other.get(`/lists/${copyId}`).expect(200)).body
    expect(copy).toMatchObject({
      id: copyId, ownerId: other.id, ownerHandle: other.handle, city: 'Roma', title: 'Roma klasikleri (kopya)',
      visibility: 'private', allowCopy: true, allowComments: true, myRole: 'owner', memberCount: 0,
    })
    const strip = (i: any) => ({ ...i, details: Object.fromEntries(Object.entries(i.details).filter(([k]) => k !== 'photos')) })
    expect(copy.items).toEqual(src.items.map(strip))
    expect(copy.items.map((i: any) => i.category)).toEqual(['museum', 'food', 'other'])
    expect(copy.items[0].details).toEqual({ spendPerPerson: 20, currency: 'EUR', favorites: ['Tavan'] })
    expect(src.items[0].details.photos).toEqual([photo])
    await owner.get(`/lists/${copyId}`).expect(404) // private copy of someone else
    expect((await other.get('/lists/mine').expect(200)).body.find((l: any) => l.id === copyId))
      .toMatchObject({ title: 'Roma klasikleri (kopya)', visibility: 'private', itemCount: 3, role: 'owner' })

    // The owner always copies their own list, even private with allowCopy off; an empty list copies too.
    await owner.patch(`/lists/${id}`, { visibility: 'private', allowCopy: false }).expect(200)
    const own = (await owner.post(`/lists/${id}/copy`).expect(201)).body.id
    const ownCopy = (await owner.get(`/lists/${own}`).expect(200)).body
    expect(ownCopy).toMatchObject({ title: 'Roma klasikleri (kopya)', visibility: 'private', allowCopy: true })
    expect(ownCopy.items[0].details.photos).toBeUndefined()
    const { id: empty } = await listWithItems(owner, [], { title: 'x'.repeat(200) })
    const emptyCopy = (await owner.get(`/lists/${(await owner.post(`/lists/${empty}/copy`).expect(201)).body.id}`).expect(200)).body
    expect(emptyCopy.items).toEqual([])
    expect(emptyCopy.title).toBe('x'.repeat(192) + ' (kopya)')
  })

  it('AC-CPY-2: allowCopy off 403 for others; private list 404 for non-members; block 404; members follow allowCopy', async () => {
    const { id } = await listWithItems(owner, [place()], { visibility: 'public' })
    await owner.patch(`/lists/${id}`, { allowCopy: false }).expect(200)
    await other.post(`/lists/${id}/copy`).expect(403)
    await owner.patch(`/lists/${id}`, { allowCopy: true, visibility: 'private' }).expect(200)
    await other.post(`/lists/${id}/copy`).expect(404)
    await other.post('/lists/99999999/copy').expect(404)
    await api(app).post(`/lists/${id}/copy`).expect(401)

    // Block in either direction hides the public list.
    await owner.patch(`/lists/${id}`, { visibility: 'public' }).expect(200)
    const blocked = await register(app)
    await owner.post(`/blocks/${blocked.id}`).expect(200)
    await blocked.post(`/lists/${id}/copy`).expect(404)
    const blocker = await register(app)
    await blocker.post(`/blocks/${owner.id}`).expect(200)
    await blocker.post(`/lists/${id}/copy`).expect(404)

    // A member of a private list may copy it when allowCopy is on, else 403.
    const editor = await register(app)
    await mutualFollow(owner, editor)
    await owner.patch(`/lists/${id}`, { visibility: 'private' }).expect(200)
    await owner.post(`/lists/${id}/members`, { handle: editor.handle }).expect(201)
    await editor.post(`/lists/${id}/copy`).expect(201)
    await owner.patch(`/lists/${id}`, { allowCopy: false }).expect(200)
    await editor.post(`/lists/${id}/copy`).expect(403)
  })

  it('AC-CPY-3: the copy is independent; it is a save for the copier (once per place), never for the owner', async () => {
    const city = `Cpy-${RUN}`
    const a = place({ city })
    const b = place({ city })
    const { id } = await listWithItems(owner, [a, b], { city, visibility: 'public' }) // owner saves a, b
    const copyId = (await other.post(`/lists/${id}/copy`).expect(201)).body.id // other saves a, b

    // Changing the original does not change the copy, and the other way round.
    await owner.put(`/lists/${id}/items`, { items: [{ ...b, note: 'değişti' }] }).expect(200)
    await owner.patch(`/lists/${id}`, { title: 'Yeni ad' }).expect(200)
    const copy = (await other.get(`/lists/${copyId}`).expect(200)).body
    expect(copy.items.map((i: any) => [i.name, i.note])).toEqual([[a.name, ''], [b.name, '']])
    expect(copy.title).not.toBe('Yeni ad (kopya)')
    await other.put(`/lists/${copyId}/items`, { items: [] }).expect(200)
    expect((await owner.get(`/lists/${id}`).expect(200)).body.items).toHaveLength(1)

    // Saves: owner 1 + copier 1 per place. Copying again, or the owner copying their own list, adds nothing.
    await owner.put(`/lists/${id}/items`, { items: [a, b] }).expect(200)
    await other.post(`/lists/${id}/copy`).expect(201)
    await owner.post(`/lists/${id}/copy`).expect(201)
    const home = (await other.get(`/discover/home?city=${city}`).expect(200)).body
    const saves = (name: string) => home.mostSearched.find((p: any) => p.name === name)?.saves7d
    expect(saves(a.name)).toBe(2)
    expect(saves(b.name)).toBe(2)
    // A third person copying counts once more.
    const third = await register(app)
    await third.post(`/lists/${id}/copy`).expect(201)
    const after = (await other.get(`/discover/home?city=${city}`).expect(200)).body
    expect(after.mostSearched.find((p: any) => p.name === a.name).saves7d).toBe(3)
  })
})
