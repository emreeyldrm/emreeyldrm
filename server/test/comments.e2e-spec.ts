import { INestApplication } from '@nestjs/common'
import { Client, createApp, item, listWithItems, mutualFollow, register, uniq } from './helpers'

describe('Comments', () => {
  let app: INestApplication
  let author: Client
  let placeId: number
  const ids = async (c: Client) => (await c.get(`/places/${placeId}/comments`).expect(200)).body.map((x: any) => x.body)

  beforeAll(async () => {
    app = await createApp()
    author = await register(app, uniq('author_c'))
    placeId = (await listWithItems(author, [item(1)])).placeIds[0]
  })
  afterAll(async () => { await app.close() })

  it('AC-CMT-1: comments default to public; empty or over 1000 chars gives 400', async () => {
    const u = await register(app)
    const created = await u.post(`/places/${placeId}/comments`, { body: 'Great place' }).expect(201)
    expect(created.body).toEqual({ id: expect.any(Number) })
    const list = (await u.get(`/places/${placeId}/comments`).expect(200)).body
    const c = list.find((x: any) => x.id === created.body.id)
    expect(c).toEqual({
      id: created.body.id, parentId: null, body: 'Great place', visibility: 'public',
      createdAt: expect.any(String), authorId: u.id, author: u.handle,
    })
    expect(Number.isNaN(Date.parse(c.createdAt))).toBe(false)
    await u.post(`/places/${placeId}/comments`, { body: '' }).expect(400)
    await u.post(`/places/${placeId}/comments`, { body: '   ' }).expect(400)
    await u.post(`/places/${placeId}/comments`, {}).expect(400)
    await u.post(`/places/${placeId}/comments`, { body: 'x'.repeat(1001) }).expect(400)
    await u.post(`/places/${placeId}/comments`, { body: 'x'.repeat(1000) }).expect(201)
    await u.post('/places/999999/comments', { body: 'nobody home' }).expect(404)
  })

  it('AC-CMT-2: an invalid visibility gives 400', async () => {
    const u = await register(app)
    const res = await u.post(`/places/${placeId}/comments`, { body: 'x', visibility: 'secret' }).expect(400)
    expect(res.body).toEqual({ error: expect.any(String) })
    await u.post(`/places/${placeId}/comments`, { body: 'x', visibility: 'PUBLIC' }).expect(400)
  })

  it('AC-CMT-3: a private comment is visible only to its author', async () => {
    const w = await register(app)
    const friend = await register(app)
    const stranger = await register(app)
    await mutualFollow(w, friend)
    await w.post(`/places/${placeId}/comments`, { body: 'cmt3-private', visibility: 'private' }).expect(201)
    expect(await ids(w)).toContain('cmt3-private')
    expect(await ids(friend)).not.toContain('cmt3-private')
    expect(await ids(stranger)).not.toContain('cmt3-private')
  })

  it('AC-CMT-4: friends comment is visible only to mutual followers, not one-way followers or strangers', async () => {
    const w = await register(app)
    const mutual = await register(app)
    const oneWayFollower = await register(app) // follows w, w does not follow back
    const followedByW = await register(app) // w follows them, they do not follow back
    const stranger = await register(app)
    await mutualFollow(w, mutual)
    await oneWayFollower.post(`/follows/${w.id}`).expect(200)
    await w.post(`/follows/${followedByW.id}`).expect(200)
    await w.post(`/places/${placeId}/comments`, { body: 'cmt4-friends', visibility: 'friends' }).expect(201)
    expect(await ids(w)).toContain('cmt4-friends')
    expect(await ids(mutual)).toContain('cmt4-friends')
    expect(await ids(oneWayFollower)).not.toContain('cmt4-friends')
    expect(await ids(followedByW)).not.toContain('cmt4-friends')
    expect(await ids(stranger)).not.toContain('cmt4-friends')
    // unfollowing one side revokes access
    await mutual.del(`/follows/${w.id}`).expect(200)
    expect(await ids(mutual)).not.toContain('cmt4-friends')
  })

  it('AC-CMT-5: a public comment is visible to everyone', async () => {
    const w = await register(app)
    const stranger = await register(app)
    await w.post(`/places/${placeId}/comments`, { body: 'cmt5-public', visibility: 'public' }).expect(201)
    expect(await ids(stranger)).toContain('cmt5-public')
    expect(await ids(w)).toContain('cmt5-public')
  })

  it('AC-CMT-6: more than 5 comments per minute from one user gives 429', async () => {
    const u = await register(app) // fresh user, nothing posted yet
    for (let i = 1; i <= 5; i++) await u.post(`/places/${placeId}/comments`, { body: `rate ${i}` }).expect(201)
    const res = await u.post(`/places/${placeId}/comments`, { body: 'rate 6' }).expect(429)
    expect(res.body).toEqual({ error: expect.any(String) })
    // other users are not affected
    const other = await register(app)
    await other.post(`/places/${placeId}/comments`, { body: 'unaffected' }).expect(201)
  })

  it('AC-CMT-7: only the author can delete their own comment', async () => {
    const w = await register(app)
    const other = await register(app)
    const { id } = (await w.post(`/places/${placeId}/comments`, { body: 'cmt7-mine' }).expect(201)).body
    await other.del(`/comments/${id}`).expect(404)
    expect(await ids(other)).toContain('cmt7-mine')
    await w.del(`/comments/${id}`).expect(200).expect({ ok: true })
    expect(await ids(other)).not.toContain('cmt7-mine')
    expect(await ids(w)).not.toContain('cmt7-mine')
  })

  it('AC-CMT-8: 3 distinct reporters hide a comment from everyone including the author; repeat reports do not count', async () => {
    const w = await register(app)
    const [r1, r2, r3] = [await register(app), await register(app), await register(app)]
    const watcher = await register(app)
    const { id } = (await w.post(`/places/${placeId}/comments`, { body: 'cmt8-spam' }).expect(201)).body
    const report = (c: Client) => c.post('/reports', { targetType: 'comment', targetId: id, reason: 'spam' })

    const first = await report(r1).expect(201)
    expect(first.body).toEqual({ ok: true })
    await report(r1).expect(201)
    await report(r1).expect(201)
    await report(r2).expect(201)
    expect(await ids(watcher)).toContain('cmt8-spam') // only 2 distinct reporters so far
    expect(await ids(w)).toContain('cmt8-spam')

    await report(r3).expect(201)
    for (const c of [watcher, w, r1, r2, r3]) expect(await ids(c)).not.toContain('cmt8-spam')

    await w.post('/reports', { targetType: 'bogus', targetId: 1, reason: 'x' }).expect(400)
    await w.post('/reports', { targetType: 'comment', targetId: id }).expect(400)
    await w.post('/reports', { targetType: 'user', targetId: r1.id, reason: 'rude' }).expect(201)
    await w.post('/reports', { targetType: 'list', targetId: 1, reason: 'bad' }).expect(201)
  })

  it('AC-CMT-9: a block hides comments in both directions and unblocking restores them', async () => {
    const a = await register(app)
    const b = await register(app)
    await a.post(`/places/${placeId}/comments`, { body: 'cmt9-from-a' }).expect(201)
    await b.post(`/places/${placeId}/comments`, { body: 'cmt9-from-b' }).expect(201)
    expect(await ids(a)).toEqual(expect.arrayContaining(['cmt9-from-a', 'cmt9-from-b']))

    await a.post(`/blocks/${b.id}`).expect(200)
    let seenByA = await ids(a)
    let seenByB = await ids(b)
    expect(seenByA).toContain('cmt9-from-a')
    expect(seenByA).not.toContain('cmt9-from-b')
    expect(seenByB).toContain('cmt9-from-b')
    expect(seenByB).not.toContain('cmt9-from-a')

    await a.del(`/blocks/${b.id}`).expect(200)
    seenByA = await ids(a)
    seenByB = await ids(b)
    expect(seenByA).toContain('cmt9-from-b')
    expect(seenByB).toContain('cmt9-from-a')
  })
})
