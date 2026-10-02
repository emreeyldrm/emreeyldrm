import { INestApplication } from '@nestjs/common'
import { api, createApp, item, listWithItems, register, uniq } from './helpers'

describe('Auth', () => {
  let app: INestApplication
  const http = () => api(app)
  beforeAll(async () => { app = await createApp() })
  afterAll(async () => { await app.close() })

  it('AC-AUTH-1: registers with valid email, password and handle and returns a token', async () => {
    const [handle, email] = [uniq('alice_1'), `${uniq('a')}@example.com`]
    const res = await http().post('/auth/register').send({ email, password: 'password1', handle }).expect(201)
    expect(typeof res.body.token).toBe('string')
    expect(res.body.user).toEqual({ id: expect.any(Number), handle, email })
    const me = await http().get('/me').set('Authorization', `Bearer ${res.body.token}`).expect(200)
    expect(me.body).toEqual(res.body.user)
  })

  it('AC-AUTH-2: duplicate email or duplicate handle returns 409', async () => {
    const [dupEmail, dupHandle] = [`${uniq('dup')}@example.com`, uniq('dup_one')]
    await http().post('/auth/register').send({ email: dupEmail, password: 'password1', handle: dupHandle }).expect(201)
    const sameEmail = await http().post('/auth/register').send({ email: dupEmail, password: 'password1', handle: uniq('dup_two') }).expect(409)
    expect(sameEmail.body.error).toEqual(expect.any(String))
    await http().post('/auth/register').send({ email: `${uniq('other')}@example.com`, password: 'password1', handle: dupHandle }).expect(409)
  })

  it('AC-AUTH-3: invalid handle or short password returns 400 with an error body', async () => {
    const base = { email: 'v@example.com', password: 'password1', handle: 'valid_h' }
    for (const handle of ['Upper', 'ab', 'has space', 'x'.repeat(21)]) {
      const res = await http().post('/auth/register').send({ ...base, handle }).expect(400)
      expect(res.body).toEqual({ error: expect.any(String) })
    }
    await http().post('/auth/register').send({ ...base, password: 'short' }).expect(400)
    await http().post('/auth/register').send({ ...base, email: 'not-an-email' }).expect(400)
  })

  it('AC-AUTH-4: login with correct credentials gives a token, wrong password gives 401', async () => {
    const [email, handle] = [`${uniq('log')}@example.com`, uniq('login_u')]
    await http().post('/auth/register').send({ email, password: 'password1', handle }).expect(201)
    const ok = await http().post('/auth/login').send({ email, password: 'password1' }).expect(200)
    expect(typeof ok.body.token).toBe('string')
    expect(ok.body.user.handle).toBe(handle)
    const bad = await http().post('/auth/login').send({ email, password: 'wrong-pass' }).expect(401)
    expect(bad.body).toEqual({ error: expect.any(String) })
    await http().post('/auth/login').send({ email: 'nobody@example.com', password: 'password1' }).expect(401)
  })

  it('AC-AUTH-5: protected endpoints return 401 without a token or with a broken token', async () => {
    for (const [method, url] of [['get', '/me'], ['get', '/lists/mine'], ['get', '/discover/lists'], ['get', '/following']] as const) {
      const res = await http()[method](url).expect(401)
      expect(res.body).toEqual({ error: expect.any(String) })
      await http()[method](url).set('Authorization', 'Bearer garbage.token.here').expect(401)
    }
    await http().get('/me').set('Authorization', 'Basic abc').expect(401)
  })

  it('AC-AUTH-6: deleting the account removes lists, ratings, comments and follows; old token gets 401', async () => {
    const victim = await register(app, uniq('victim_u'))
    const other = await register(app, uniq('other_u'))
    const { id: listId, placeIds } = await listWithItems(victim, [item(1)], { visibility: 'public' })
    const placeId = placeIds[0]
    await victim.put(`/places/${placeId}/rating`, { stars: 4 }).expect(200)
    await other.put(`/places/${placeId}/rating`, { stars: 2 }).expect(200)
    await victim.post(`/places/${placeId}/comments`, { body: 'hi there' }).expect(201)
    await victim.post(`/follows/${other.id}`).expect(200)
    await other.post(`/follows/${victim.id}`).expect(200)
    await other.get(`/lists/${listId}`).expect(200)

    await victim.del('/me').expect(200).expect({ ok: true })

    await http().get('/me').set('Authorization', `Bearer ${victim.token}`).expect(401)
    await other.get(`/lists/${listId}`).expect(404)
    const place = await other.get(`/places/${placeId}`).expect(200)
    expect(place.body.rating.count).toBe(1)
    expect(place.body.rating.avg).toBe(2)
    const comments = await other.get(`/places/${placeId}/comments`).expect(200)
    expect(comments.body).toEqual([])
    const following = await other.get('/following').expect(200)
    expect(following.body).toEqual([])
    const search = await other.get(`/users/search?q=${victim.handle}`).expect(200)
    expect(search.body).toEqual([])
    // the handle is free again
    await register(app, victim.handle)
  })
})
