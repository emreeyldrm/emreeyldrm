import { INestApplication } from '@nestjs/common'
import { api, Client, createApp, item, listWithItems, mutualFollow, register, RUN } from './helpers'

/**
 * MSG: messaging between friends (docs/ACCEPTANCE.md, "Mesajlaşma (MSG)").
 * Runs in-process and against the Worker (`npm run test:contract` in backend/, one shared database: unique names).
 */
let n = 7000
const place = (extra: object = {}) => item(++n, extra)

describe('Messaging (MSG)', () => {
  let app: INestApplication
  let a: Client
  let b: Client
  let stranger: Client

  const open = async (from: Client, to: Client, status = 201) =>
    (await from.post('/conversations', { handle: to.handle }).expect(status)).body.id as number
  const send = (from: Client, id: number, body: object) => from.post(`/conversations/${id}/messages`, body)
  const history = async (c: Client, id: number, query = '') => (await c.get(`/conversations/${id}/messages${query}`).expect(200)).body
  const unread = async (c: Client) => (await c.get('/conversations/unread').expect(200)).body.count as number
  const conversations = async (c: Client) => (await c.get('/conversations').expect(200)).body
  const friends = async () => {
    const x = await register(app)
    const y = await register(app)
    await mutualFollow(x, y)
    return [x, y] as const
  }

  beforeAll(async () => {
    app = await createApp()
    a = await register(app)
    b = await register(app)
    stranger = await register(app)
    await mutualFollow(a, b)
  })
  afterAll(async () => { await app.close() })

  it('AC-MSG-1: friends open one conversation (same id again, from either side); non-friends 403', async () => {
    const id = await open(a, b, 201)
    expect(id).toEqual(expect.any(Number))
    expect(await open(a, b, 200)).toBe(id)
    expect((await b.post('/conversations', { handle: a.handle.toUpperCase() }).expect(200)).body).toEqual({ id })

    const listed = (await conversations(a)).find((c: any) => c.id === id)
    expect(listed).toEqual({ id, other: { id: b.id, handle: b.handle }, lastMessage: null, unread: 0 })
    expect((await a.get(`/conversations/${id}`).expect(200)).body).toEqual({ id, other: { id: b.id, handle: b.handle }, canSend: true })

    // Not friends: a stranger, and a one-way follow in either direction.
    await a.post('/conversations', { handle: stranger.handle }).expect(403)
    const fan = await register(app)
    await fan.post(`/follows/${a.id}`).expect(200)
    await fan.post('/conversations', { handle: a.handle }).expect(403)
    await a.post('/conversations', { handle: fan.handle }).expect(403)
    expect((await conversations(fan))).toEqual([])

    await a.post('/conversations', { handle: a.handle }).expect(400)
    await a.post('/conversations', { handle: `nobody_${RUN}` }).expect(404)
    await a.post('/conversations', {}).expect(400)
    await a.post('/conversations', { handle: 7 }).expect(400)
    await api(app).post('/conversations').send({ handle: b.handle }).expect(401)
    await api(app).get('/conversations').expect(401)
    await api(app).get('/conversations/unread').expect(401)
  })

  it('AC-MSG-2: send/receive, `after` returns only newer, unread counts up and resets on read', async () => {
    const [x, y] = await friends()
    const id = await open(x, y)
    const first = await send(x, id, { body: '  Merhaba!  ' }).expect(201)
    expect(first.body).toEqual({ id: expect.any(Number), senderId: x.id, body: 'Merhaba!', attachment: null, createdAt: expect.any(String) })
    expect(Number.isNaN(Date.parse(first.body.createdAt))).toBe(false)

    // The sender's own messages are never unread for them.
    expect(await unread(x)).toBe(0)
    expect(await unread(y)).toBe(1)
    let [cy] = await conversations(y)
    expect(cy).toEqual({
      id, other: { id: x.id, handle: x.handle }, unread: 1,
      lastMessage: { body: 'Merhaba!', attachmentType: null, createdAt: first.body.createdAt, senderId: x.id },
    })

    const reply = (await send(y, id, { body: 'Selam' }).expect(201)).body
    const third = (await send(x, id, { body: 'Nasılsın?' }).expect(201)).body
    expect(await unread(x)).toBe(1)
    expect(await unread(y)).toBe(2)

    // Both members read the same history, oldest first.
    const all = await history(y, id)
    expect(all.map((m: any) => [m.senderId, m.body])).toEqual([[x.id, 'Merhaba!'], [y.id, 'Selam'], [x.id, 'Nasılsın?']])
    expect(await history(x, id)).toEqual(all)
    // `after` returns only newer messages; `limit` caps (oldest first after the cursor, newest when no cursor).
    expect((await history(x, id, `?after=${first.body.id}`)).map((m: any) => m.id)).toEqual([reply.id, third.id])
    expect(await history(x, id, `?after=${third.id}`)).toEqual([])
    expect((await history(x, id, `?after=${first.body.id}&limit=1`)).map((m: any) => m.id)).toEqual([reply.id])
    expect((await history(x, id, '?limit=2')).map((m: any) => m.id)).toEqual([reply.id, third.id])
    await x.get(`/conversations/${id}/messages?after=abc`).expect(400)
    await x.get(`/conversations/${id}/messages?limit=0`).expect(400)
    await x.get(`/conversations/${id}/messages?limit=101`).expect(400)

    // Reading resets the count; new messages count again.
    expect((await y.post(`/conversations/${id}/read`).expect(200)).body).toEqual({ ok: true })
    expect(await unread(y)).toBe(0)
    expect((await conversations(y))[0].unread).toBe(0)
    await send(x, id, { body: 'Bir' }).expect(201)
    await send(x, id, { body: 'İki' }).expect(201)
    expect(await unread(y)).toBe(2)
    expect(await unread(x)).toBe(1)
    await x.post(`/conversations/${id}/read`).expect(200)
    expect(await unread(x)).toBe(0)
    expect(await unread(y)).toBe(2)

    // Ordered by the last message; the total sums every conversation.
    const z = await register(app)
    await mutualFollow(y, z)
    const other = await open(z, y)
    await send(z, other, { body: 'Ben de buradayım' }).expect(201)
    const list = await conversations(y)
    expect(list.map((c: any) => c.id)).toEqual([other, id])
    expect(list.map((c: any) => c.unread)).toEqual([1, 2])
    expect(await unread(y)).toBe(3)
    await send(x, id, { body: 'Son' }).expect(201)
    expect((await conversations(y)).map((c: any) => c.id)).toEqual([id, other])
    ;[cy] = await conversations(y)
    expect(cy.lastMessage).toMatchObject({ body: 'Son', senderId: x.id })
  })

  it('AC-MSG-3: place and list attachments carry title/subtitle; a private list leaks only "Özel liste"', async () => {
    const [x, y] = await friends()
    const id = await open(x, y)
    const pub = await listWithItems(x, [place({ name: 'Galata Kulesi', category: 'historic', city: 'Istanbul' }), place()],
      { city: 'Istanbul', title: `Gezilecekler ${RUN}`, visibility: 'public' })
    const priv = await listWithItems(x, [place()], { city: 'Roma', title: `Gizli rota ${RUN}` })
    const placeId = pub.placeIds[0]

    const sentPlace = (await send(x, id, { attachment: { type: 'place', id: placeId } }).expect(201)).body
    expect(sentPlace).toMatchObject({
      senderId: x.id, body: '',
      attachment: { type: 'place', id: placeId, title: 'Galata Kulesi', subtitle: 'Istanbul', category: 'historic' },
    })
    expect((await conversations(y))[0].lastMessage).toMatchObject({ body: '', attachmentType: 'place', senderId: x.id })

    await send(x, id, { body: 'Bu listeye bak', attachment: { type: 'list', id: pub.id } }).expect(201)
    await send(x, id, { attachment: { type: 'list', id: priv.id } }).expect(201)

    const seenByY = await history(y, id)
    expect(seenByY.map((m: any) => m.attachment)).toEqual([
      { type: 'place', id: placeId, title: 'Galata Kulesi', subtitle: 'Istanbul', category: 'historic' },
      { type: 'list', id: pub.id, title: `Gezilecekler ${RUN}`, subtitle: 'Istanbul · 2 yer', category: null },
      { type: 'list', id: priv.id, title: 'Özel liste', subtitle: null, category: null },
    ])
    expect(seenByY[1].body).toBe('Bu listeye bak')
    expect(JSON.stringify(seenByY)).not.toContain('Gizli rota')
    expect(JSON.stringify(seenByY)).not.toContain('Roma')
    // The sender (owner) still sees the private list's title.
    expect((await history(x, id))[2].attachment).toEqual(
      { type: 'list', id: priv.id, title: `Gizli rota ${RUN}`, subtitle: 'Roma · 1 yer', category: null })
    // Opening it still follows the list rules.
    await y.get(`/lists/${priv.id}`).expect(404)
    // Once y is an editor of the list, y sees its title too.
    await x.post(`/lists/${priv.id}/members`, { handle: y.handle }).expect(201)
    expect((await history(y, id))[2].attachment.title).toBe(`Gizli rota ${RUN}`)

    // Only things the sender can open: someone else's private list, a missing place or list, bad shapes -> 400.
    const strangers = await listWithItems(stranger, [place()], { title: 'Başkasının' })
    await send(x, id, { attachment: { type: 'list', id: strangers.id } }).expect(400)
    await send(x, id, { attachment: { type: 'place', id: 99999999 } }).expect(400)
    await send(x, id, { attachment: { type: 'list', id: 99999999 } }).expect(400)
    await send(x, id, { attachment: { type: 'user', id: y.id } }).expect(400)
    await send(x, id, { attachment: { type: 'place', id: 'abc' } }).expect(400)
    await send(x, id, { attachment: 'place' }).expect(400)
    // A public list of someone else can be shared.
    const theirs = await listWithItems(stranger, [place()], { title: `Açık ${RUN}`, visibility: 'public' })
    await send(x, id, { attachment: { type: 'list', id: theirs.id } }).expect(201)
  })

  it('AC-MSG-4: non-member 404; block 403 (history stays readable); empty/long 400; rate limit 429; account deletion', async () => {
    const [x, y] = await friends()
    const id = await open(x, y)
    await send(x, id, { body: 'ilk' }).expect(201)

    // Not a member (or no such conversation): 404 everywhere.
    await stranger.get(`/conversations/${id}`).expect(404)
    await stranger.get(`/conversations/${id}/messages`).expect(404)
    await send(stranger, id, { body: 'merhaba' }).expect(404)
    await stranger.post(`/conversations/${id}/read`).expect(404)
    await x.get('/conversations/99999999/messages').expect(404)
    await send(x, 99999999, { body: 'x' }).expect(404)
    await x.get('/conversations/abc/messages').expect(404)
    await api(app).get(`/conversations/${id}/messages`).expect(401)

    // Body validation.
    await send(x, id, {}).expect(400)
    await send(x, id, { body: '' }).expect(400)
    await send(x, id, { body: '   ' }).expect(400)
    await send(x, id, { body: 42 }).expect(400)
    await send(x, id, { body: 'a'.repeat(2001) }).expect(400)
    expect((await send(x, id, { body: 'a'.repeat(2000) }).expect(201)).body.body).toHaveLength(2000)

    // Block (either side): no sending, no reopening; the existing conversation stays readable.
    await y.post(`/blocks/${x.id}`).expect(200)
    await send(x, id, { body: 'hâlâ orada mısın?' }).expect(403)
    await send(y, id, { body: 'hayır' }).expect(403)
    await x.post('/conversations', { handle: y.handle }).expect(403)
    expect((await history(x, id)).length).toBe(2)
    expect((await y.get(`/conversations/${id}`).expect(200)).body.canSend).toBe(false)
    expect((await conversations(x)).map((c: any) => c.id)).toContain(id)
    await y.del(`/blocks/${x.id}`).expect(200)
    // The block removed the follows, so they are not friends any more: still 403 until they follow each other again.
    await send(x, id, { body: 'tekrar' }).expect(403)
    await mutualFollow(x, y)
    expect(await open(x, y, 200)).toBe(id)
    await send(x, id, { body: 'tekrar' }).expect(201)

    // At most 30 messages a minute per sender.
    const [r, s] = await friends()
    const rid = await open(r, s)
    for (let i = 0; i < 30; i++) await send(r, rid, { body: `m${i}` }).expect(201)
    await send(r, rid, { body: 'çok fazla' }).expect(429)
    await send(s, rid, { body: 'ben sınırda değilim' }).expect(201)

    // Account deletion removes the user's conversations and messages for both sides.
    const [d, e] = await friends()
    const did = await open(d, e)
    await send(d, did, { body: 'görüşürüz' }).expect(201)
    await send(e, did, { body: 'hoşça kal' }).expect(201)
    expect(await unread(e)).toBe(1)
    await d.del('/me').expect(200)
    expect(await conversations(e)).toEqual([])
    expect(await unread(e)).toBe(0)
    await e.get(`/conversations/${did}/messages`).expect(404)
    await send(e, did, { body: 'orada mısın?' }).expect(404)
  })
})
