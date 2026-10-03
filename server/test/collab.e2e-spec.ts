import { INestApplication } from '@nestjs/common'
import { api, Client, createApp, item, listWithItems, mutualFollow, register, RUN } from './helpers'

/**
 * COL: shared lists (docs/ACCEPTANCE.md, "Ortak listeler"). Authorization is enforced in code on every request,
 * so besides AC-COL-1..5 this file audits each list endpoint for the editor role.
 * Runs in-process and against the Worker (`npm run test:contract` in backend/, one shared database: unique names).
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

let n = 3000
const place = (extra: object = {}) => item(++n, extra)
/** Request body item from a GET /lists/:id item (what clients send back when re-saving). */
const back = (i: any) => ({ provider: i.provider, providerId: i.providerId, name: i.name, category: i.category, note: i.note, details: i.details })

describe('Shared lists (COL)', () => {
  let app: INestApplication
  let owner: Client
  let editor: Client
  let friend: Client
  let stranger: Client
  const upload = async (c: Client) =>
    (await api(app).post('/media').set('Content-Type', 'image/png').set('Authorization', `Bearer ${c.token}`).send(PNG).expect(201)).body.id as string
  const members = async (c: Client, id: number) => (await c.get(`/lists/${id}/members`).expect(200)).body
  const sharedList = async (opts: { visibility?: string; items?: object[] } = {}) => {
    const { id } = await listWithItems(owner, opts.items ?? [place()], { title: 'Ortak', visibility: opts.visibility })
    await owner.post(`/lists/${id}/members`, { handle: editor.handle }).expect(201)
    return id
  }

  beforeAll(async () => {
    app = await createApp()
    owner = await register(app)
    editor = await register(app)
    friend = await register(app)
    stranger = await register(app)
    await mutualFollow(owner, editor)
    await mutualFollow(owner, friend)
  })
  afterAll(async () => { await app.close() })

  it('AC-COL-1: only the owner adds friends; non-friend/block 403, unknown handle 404, owner 400, repeat 200, at most 20', async () => {
    const { id } = await listWithItems(owner, [place()])
    const added = await owner.post(`/lists/${id}/members`, { handle: editor.handle }).expect(201)
    expect(added.body).toEqual({ id: editor.id, handle: editor.handle, role: 'editor', addedAt: expect.any(String) })
    const again = await owner.post(`/lists/${id}/members`, { handle: editor.handle.toUpperCase() }).expect(200)
    expect(again.body).toEqual(added.body)
    expect(await members(owner, id)).toEqual([added.body])

    // One-way follow is not friendship.
    const fan = await register(app)
    await fan.post(`/follows/${owner.id}`).expect(200)
    await owner.post(`/lists/${id}/members`, { handle: fan.handle }).expect(403)
    await owner.post(`/lists/${id}/members`, { handle: stranger.handle }).expect(403)
    // Block in either direction.
    const blocker = await register(app)
    await mutualFollow(owner, blocker)
    await blocker.post(`/blocks/${owner.id}`).expect(200)
    await owner.post(`/lists/${id}/members`, { handle: blocker.handle }).expect(403)

    await owner.post(`/lists/${id}/members`, { handle: `nobody_${RUN}` }).expect(404)
    await owner.post(`/lists/${id}/members`, { handle: owner.handle }).expect(400)
    await owner.post(`/lists/${id}/members`, {}).expect(400)
    await owner.post(`/lists/${id}/members`, { handle: 5 }).expect(400)
    // Non-owners: an editor 403, a stranger on a private list 404, a missing list 404, no session 401.
    await editor.post(`/lists/${id}/members`, { handle: friend.handle }).expect(403)
    await stranger.post(`/lists/${id}/members`, { handle: friend.handle }).expect(404)
    await owner.post('/lists/99999999/members', { handle: friend.handle }).expect(404)
    await api(app).post(`/lists/${id}/members`).send({ handle: friend.handle }).expect(401)
    expect((await members(owner, id)).map((m: any) => m.id)).toEqual([editor.id])

    // At most 20 members.
    for (let i = 0; i < 19; i++) {
      const f = await register(app)
      await mutualFollow(owner, f)
      await owner.post(`/lists/${id}/members`, { handle: f.handle }).expect(201)
    }
    expect(await members(owner, id)).toHaveLength(20)
    await owner.post(`/lists/${id}/members`, { handle: friend.handle }).expect(400)
    await owner.post(`/lists/${id}/members`, { handle: editor.handle }).expect(200) // already a member: no change
    expect((await owner.get(`/lists/${id}`).expect(200)).body.memberCount).toBe(20)
  })

  it('AC-COL-2: an editor sees the private list and replaces its items, but cannot delete it, change settings or add members', async () => {
    const id = await sharedList()
    const seen = await editor.get(`/lists/${id}`).expect(200)
    expect(seen.body).toMatchObject({ id, ownerId: owner.id, ownerHandle: owner.handle, visibility: 'private', myRole: 'editor' })

    const items = [...seen.body.items.map(back), place({ note: 'editörden' })]
    await editor.put(`/lists/${id}/items`, { items }).expect(200).expect({ ok: true, count: 2 })
    const after = (await owner.get(`/lists/${id}`).expect(200)).body
    expect(after.items.map((i: any) => i.note)).toEqual(['', 'editörden'])

    await editor.patch(`/lists/${id}`, { title: 'Ele geçirildi' }).expect(403)
    await editor.patch(`/lists/${id}`, { visibility: 'public' }).expect(403)
    await editor.patch(`/lists/${id}`, { allowCopy: false, allowComments: false }).expect(403)
    await editor.del(`/lists/${id}`).expect(403)
    await editor.post(`/lists/${id}/members`, { handle: friend.handle }).expect(403)
    // Editors see the member list but may remove only themselves.
    await owner.post(`/lists/${id}/members`, { handle: friend.handle }).expect(201)
    expect((await members(editor, id)).map((m: any) => m.handle)).toEqual([editor.handle, friend.handle])
    await editor.del(`/lists/${id}/members/${friend.id}`).expect(403)
    await editor.del(`/lists/${id}/members/${owner.id}`).expect(400)

    const unchanged = (await owner.get(`/lists/${id}`).expect(200)).body
    expect(unchanged).toMatchObject({ title: 'Ortak', visibility: 'private', allowCopy: true, allowComments: true, memberCount: 2 })

    // Strangers keep the private-list 404 everywhere; a public viewer is not an editor.
    await stranger.get(`/lists/${id}`).expect(404)
    await stranger.put(`/lists/${id}/items`, { items: [] }).expect(404)
    await stranger.get(`/lists/${id}/members`).expect(404)
    await stranger.patch(`/lists/${id}`, { title: 'x' }).expect(404)
    await stranger.del(`/lists/${id}`).expect(404)
    await stranger.del(`/lists/${id}/members/${editor.id}`).expect(404)
    await owner.patch(`/lists/${id}`, { visibility: 'public' }).expect(200)
    const pub = await stranger.get(`/lists/${id}`).expect(200)
    expect(pub.body).toMatchObject({ myRole: null, memberCount: 2 })
    await stranger.put(`/lists/${id}/items`, { items: [] }).expect(404)
    await stranger.get(`/lists/${id}/members`).expect(404)
    await stranger.patch(`/lists/${id}`, { title: 'x' }).expect(404)
    await stranger.post(`/lists/${id}/members`, { handle: stranger.handle }).expect(404)
    expect((await owner.get(`/lists/${id}`).expect(200)).body.items).toHaveLength(2)
  })

  it('AC-COL-3: /lists/mine has owned and member lists with role and ownerHandle; GET /lists/:id has myRole and memberCount', async () => {
    const id = await sharedList()
    const { id: own } = await listWithItems(editor, [place()], { title: 'Kendi listem' })
    const mine = (await editor.get('/lists/mine').expect(200)).body
    expect(mine.find((l: any) => l.id === id)).toEqual({
      id, city: 'Istanbul', title: 'Ortak', visibility: 'private', allowCopy: true, allowComments: true, itemCount: 1,
      updatedAt: expect.any(String), role: 'editor', ownerHandle: owner.handle,
    })
    expect(mine.find((l: any) => l.id === own)).toMatchObject({ role: 'owner', ownerHandle: editor.handle })
    expect((await owner.get('/lists/mine').expect(200)).body.find((l: any) => l.id === id))
      .toMatchObject({ role: 'owner', ownerHandle: owner.handle })
    expect((await stranger.get('/lists/mine').expect(200)).body.find((l: any) => l.id === id)).toBeUndefined()

    expect((await owner.get(`/lists/${id}`).expect(200)).body).toMatchObject({ myRole: 'owner', memberCount: 1 })
    expect((await editor.get(`/lists/${id}`).expect(200)).body).toMatchObject({ myRole: 'editor', memberCount: 1 })
    await owner.get(`/lists/${own}`).expect(404)
    expect((await editor.get(`/lists/${own}`).expect(200)).body).toMatchObject({ myRole: 'owner', memberCount: 0 })
  })

  it('AC-COL-4: removal ends access; deleting the list or an account removes memberships; a block ends them too', async () => {
    // Owner removes the editor.
    let id = await sharedList()
    await owner.del(`/lists/${id}/members/${editor.id}`).expect(200).expect({ ok: true })
    await editor.get(`/lists/${id}`).expect(404)
    await editor.put(`/lists/${id}/items`, { items: [] }).expect(404)
    expect((await editor.get('/lists/mine').expect(200)).body.find((l: any) => l.id === id)).toBeUndefined()
    await owner.del(`/lists/${id}/members/${editor.id}`).expect(200) // not a member any more: no change
    await owner.del(`/lists/${id}/members/${owner.id}`).expect(400)
    expect(await members(owner, id)).toEqual([])

    // The editor leaves.
    id = await sharedList()
    await editor.del(`/lists/${id}/members/${editor.id}`).expect(200)
    await editor.get(`/lists/${id}`).expect(404)
    expect((await owner.get(`/lists/${id}`).expect(200)).body.memberCount).toBe(0)

    // Deleting the list removes its memberships.
    id = await sharedList()
    await owner.del(`/lists/${id}`).expect(200)
    await editor.get(`/lists/${id}`).expect(404)
    await editor.get(`/lists/${id}/members`).expect(404)
    expect((await editor.get('/lists/mine').expect(200)).body.find((l: any) => l.id === id)).toBeUndefined()

    // A block between owner and editor ends the membership.
    const pal = await register(app)
    await mutualFollow(owner, pal)
    id = await sharedList()
    await owner.post(`/lists/${id}/members`, { handle: pal.handle }).expect(201)
    await pal.post(`/blocks/${owner.id}`).expect(200)
    await pal.get(`/lists/${id}`).expect(404)
    expect((await members(owner, id)).map((m: any) => m.id)).toEqual([editor.id])

    // Deleting the member's account removes the membership; deleting the owner's account removes the list.
    const temp = await register(app)
    await mutualFollow(owner, temp)
    await owner.post(`/lists/${id}/members`, { handle: temp.handle }).expect(201)
    await temp.del('/me').expect(200)
    expect((await members(owner, id)).map((m: any) => m.id)).toEqual([editor.id])
    const boss = await register(app)
    await mutualFollow(boss, editor)
    const { id: bossList } = await listWithItems(boss, [place()])
    await boss.post(`/lists/${bossList}/members`, { handle: editor.handle }).expect(201)
    expect((await editor.get('/lists/mine').expect(200)).body.some((l: any) => l.id === bossList)).toBe(true)
    await boss.del('/me').expect(200)
    await editor.get(`/lists/${bossList}`).expect(404)
    expect((await editor.get('/lists/mine').expect(200)).body.some((l: any) => l.id === bossList)).toBe(false)
  })

  it("AC-COL-5: an editor's photos must be their own; re-saving keeps others' existing photos, but foreign media cannot be added anew", async () => {
    const id = await sharedList({ items: [place(), place()] })
    const ownerPhoto = await upload(owner)
    const editorPhoto = await upload(editor)
    const strangerPhoto = await upload(stranger)
    let items = (await owner.get(`/lists/${id}`).expect(200)).body.items.map(back)

    // The owner adds their photo to item 0; the editor cannot attach the owner's or a stranger's media anywhere new.
    items[0].details = { photos: [ownerPhoto] }
    await owner.put(`/lists/${id}/items`, { items }).expect(200)
    items = (await editor.get(`/lists/${id}`).expect(200)).body.items.map(back)
    await editor.put(`/lists/${id}/items`, { items: [items[0], { ...items[1], details: { photos: [strangerPhoto] } }] }).expect(400)
    await editor.put(`/lists/${id}/items`, { items: [items[0], { ...items[1], details: { photos: [ownerPhoto] } }] }).expect(400)

    // The editor adds their own photo and keeps the owner's existing one on item 0.
    items[0].details = { photos: [ownerPhoto, editorPhoto] }
    items[1].details = { photos: [editorPhoto], currency: 'TRY' }
    await editor.put(`/lists/${id}/items`, { items }).expect(200)

    // The owner re-saves the list as returned (keeps the editor's photos) and may reorder/edit other fields.
    items = (await owner.get(`/lists/${id}`).expect(200)).body.items.map(back)
    expect(items.map((i: any) => i.details.photos)).toEqual([[ownerPhoto, editorPhoto], [editorPhoto]])
    await owner.put(`/lists/${id}/items`, { items: [items[1], { ...items[0], note: 'not' }] }).expect(200)
    const after = (await owner.get(`/lists/${id}`).expect(200)).body.items
    expect(after.map((i: any) => i.details.photos)).toEqual([[editorPhoto], [ownerPhoto, editorPhoto]])

    // Photos are kept per place: putting someone else's photo on another place, or back after removing it, is adding it anew.
    const [x, y] = after.map(back) // x: [editorPhoto], y: [ownerPhoto, editorPhoto]
    await owner.put(`/lists/${id}/items`, { items: [{ ...x, details: {} }, y] }).expect(200)
    await owner.put(`/lists/${id}/items`, { items: [x, y] }).expect(400) // editorPhoto onto x again
    await owner.put(`/lists/${id}/items`, { items: [{ ...x, details: {} }, { ...y, details: { photos: [ownerPhoto] } }] }).expect(200)
    await owner.put(`/lists/${id}/items`, { items: [{ ...x, details: {} }, y] }).expect(400) // editorPhoto back onto y
    await owner.put(`/lists/${id}/items`, { items: [{ ...x, details: { photos: [ownerPhoto] } }, { ...y, details: { photos: [ownerPhoto] } }] }).expect(200)
    expect((await editor.get(`/lists/${id}`).expect(200)).body.items.map((i: any) => i.details.photos)).toEqual([[ownerPhoto], [ownerPhoto]])
  })

  it('TRD: places an editor adds count as saves for the editor (once per person); discover lists are unaffected', async () => {
    const city = `Col-${RUN}`
    const a = place({ city })
    const b = place({ city })
    const id = await sharedList({ items: [a] }) // owner saves a
    await editor.put(`/lists/${id}/items`, { items: [a, b] }).expect(200) // editor saves b (a was already in the list)
    await owner.put(`/lists/${id}/items`, { items: [a, b] }).expect(200) // nothing new
    await editor.put(`/lists/${id}/items`, { items: [a] }).expect(200)
    await editor.put(`/lists/${id}/items`, { items: [a, b] }).expect(200) // b again by the editor: still once
    const home = (await stranger.get(`/discover/home?city=${city}`).expect(200)).body
    const saves = (name: string) => home.mostSearched.find((p: any) => p.name === name)?.saves7d
    expect(saves(a.name)).toBe(1)
    expect(saves(b.name)).toBe(1)
    // The private shared list is not on Discover, for members either.
    expect((await editor.get(`/discover/lists?city=Istanbul`).expect(200)).body.some((l: any) => l.id === id)).toBe(false)
  })
})
