import { INestApplication } from '@nestjs/common'
import { Client, createApp, register } from './helpers'

describe('Social', () => {
  let app: INestApplication
  beforeAll(async () => { app = await createApp() })
  afterAll(async () => { await app.close() })

  it('AC-SOC-1: follow and unfollow change the /following list', async () => {
    const a = await register(app, 'soc1_a')
    const b = await register(app, 'soc1_b')
    expect((await a.get('/following').expect(200)).body).toEqual([])
    await a.post(`/follows/${b.id}`).expect(200).expect({ ok: true })
    await a.post(`/follows/${b.id}`).expect(200) // idempotent
    expect((await a.get('/following').expect(200)).body).toEqual([{ id: b.id, handle: 'soc1_b', following: true, followsMe: false }])
    await b.post(`/follows/${a.id}`).expect(200)
    expect((await a.get('/following').expect(200)).body[0].followsMe).toBe(true)
    await a.del(`/follows/${b.id}`).expect(200).expect({ ok: true })
    expect((await a.get('/following').expect(200)).body).toEqual([])
    expect((await b.get('/following').expect(200)).body).toHaveLength(1)
  })

  it('AC-SOC-2: following yourself gives 400, a missing user gives 404', async () => {
    const a = await register(app)
    const self = await a.post(`/follows/${a.id}`).expect(400)
    expect(self.body).toEqual({ error: expect.any(String) })
    const missing = await a.post('/follows/999999').expect(404)
    expect(missing.body).toEqual({ error: expect.any(String) })
  })

  it('AC-SOC-3: prefix search needs 2+ chars, hides self and blocked users, and reports following/followsMe', async () => {
    const me = await register(app, 'zq_me')
    const f1 = await register(app, 'zq_friend')
    const f2 = await register(app, 'zq_fan')
    const blocked = await register(app, 'zq_blocked')
    const blocker = await register(app, 'zq_blocker')
    await register(app, 'other_zq')
    await me.post(`/follows/${f1.id}`).expect(200)
    await f1.post(`/follows/${me.id}`).expect(200)
    await f2.post(`/follows/${me.id}`).expect(200)
    await me.post(`/blocks/${blocked.id}`).expect(200)
    await blocker.post(`/blocks/${me.id}`).expect(200)

    expect((await me.get('/users/search?q=z').expect(200)).body).toEqual([])
    expect((await me.get('/users/search').expect(200)).body).toEqual([])
    const res = (await me.get('/users/search?q=zq_').expect(200)).body
    expect(res).toEqual([
      { id: f2.id, handle: 'zq_fan', following: false, followsMe: true },
      { id: f1.id, handle: 'zq_friend', following: true, followsMe: true },
    ])
    expect((await me.get('/users/search?q=ZQ_F').expect(200)).body).toHaveLength(2) // case-insensitive prefix
    expect((await me.get('/users/search?q=zq_fr').expect(200)).body.map((u: any) => u.handle)).toEqual(['zq_friend'])
    expect((await me.get('/users/search?q=zq_blocker').expect(200)).body).toEqual([])
    expect((await me.get('/users/search?q=_zq').expect(200)).body).toEqual([]) // prefix, not substring; _ is not a wildcard
  })

  it('AC-SOC-4: blocking removes follows in both directions and prevents following the blocked user', async () => {
    const a = await register(app)
    const b = await register(app)
    await a.post(`/follows/${b.id}`).expect(200)
    await b.post(`/follows/${a.id}`).expect(200)
    await a.post(`/blocks/${b.id}`).expect(200).expect({ ok: true })
    expect((await a.get('/following').expect(200)).body).toEqual([])
    expect((await b.get('/following').expect(200)).body).toEqual([])
    await a.post(`/follows/${b.id}`).expect(404)
    await b.post(`/follows/${a.id}`).expect(404)
    await a.post(`/blocks/${a.id}`).expect(400)
    await a.post('/blocks/999999').expect(404)
  })

  it('AC-SOC-5: a block can be removed, after which following works again', async () => {
    const a = await register(app)
    const b = await register(app)
    await a.post(`/blocks/${b.id}`).expect(200)
    await a.del(`/blocks/${b.id}`).expect(200).expect({ ok: true })
    await a.del(`/blocks/${b.id}`).expect(200) // idempotent
    await a.post(`/follows/${b.id}`).expect(200)
    await b.post(`/follows/${a.id}`).expect(200)
    expect((await a.get('/following').expect(200)).body.map((u: Client) => u.id)).toEqual([b.id])
  })
})
