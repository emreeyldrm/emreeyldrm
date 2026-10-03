import { INestApplication } from '@nestjs/common'
import { api, Client, createApp, item, listWithItems, register } from './helpers'

/**
 * AC-MED-1: daily cleanup of unreferenced media. The job runs from the Worker's Cron Trigger / the NestJS timer;
 * here it is triggered through POST /test/media-cleanup, which exists only with E2E_TEST_HOOKS=1 (off-by-default is
 * covered by test/unit/cleanup-core.spec.ts). "Old" media is uploaded with X-Test-Now in the past.
 * Against the Worker the database is shared, so assertions only look at this file's media.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const HOUR = 3_600_000
const at = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString()

let n = 7000

describe('Media cleanup (MED)', () => {
  let app: INestApplication
  let u: Client
  const upload = async (c: Client, now?: string) => {
    const req = api(app).post('/media').set('Content-Type', 'image/png').set('Authorization', `Bearer ${c.token}`)
    if (now) req.set('X-Test-Now', now)
    return (await req.send(PNG).expect(201)).body.id as string
  }
  const status = async (id: string) => (await api(app).get(`/media/${id}`)).status
  const cleanup = (c: Client, now?: string) => {
    const req = c.post('/test/media-cleanup')
    if (now) req.set('X-Test-Now', now)
    return req.expect(200)
  }

  beforeAll(async () => {
    app = await createApp()
    u = await register(app)
  })
  afterAll(async () => { await app.close() })

  it('AC-MED-1: unreferenced media older than 24 hours is deleted; media in list items or comments and young media stay', async () => {
    const other = await register(app)
    const orphanOld = await upload(u, at(-48))
    const inList = await upload(u, at(-48))
    const inComment = await upload(u, at(-48))
    const inPrivateComment = await upload(other, at(-30))
    const removedFromList = await upload(u, at(-48))
    const inDeletedList = await upload(u, at(-48))
    const young = await upload(u, at(-23))
    const fresh = await upload(u)

    const { id: listId, placeIds: [pid] } = await listWithItems(u, [
      item(++n, { details: { photos: [inList, removedFromList] } }), item(++n),
    ])
    await u.put(`/lists/${listId}/items`, { items: [item(n - 1, { details: { photos: [inList] } }), item(n)] }).expect(200)
    const { id: gone } = await listWithItems(u, [item(++n, { details: { photos: [inDeletedList] } })])
    await u.del(`/lists/${gone}`).expect(200)
    await u.post(`/places/${pid}/comments`, { photos: [inComment] }).expect(201)
    await other.post(`/places/${pid}/comments`, { body: 'gizli', visibility: 'private', photos: [inPrivateComment] }).expect(201)

    const res = await cleanup(u)
    expect(res.body).toEqual({ ok: true, deleted: expect.any(Number) })
    expect(res.body.deleted).toBeGreaterThanOrEqual(3)

    for (const id of [orphanOld, removedFromList, inDeletedList]) expect(await status(id)).toBe(404)
    for (const id of [inList, inComment, inPrivateComment, young, fresh]) expect(await status(id)).toBe(200)
    expect((await u.get(`/lists/${listId}`).expect(200)).body.items[0].details.photos).toEqual([inList])

    // A day later the then-old unreferenced uploads go too; referenced ones still stay. Running again is harmless.
    await cleanup(u, at(25))
    for (const id of [young, fresh]) expect(await status(id)).toBe(404)
    for (const id of [inList, inComment, inPrivateComment]) expect(await status(id)).toBe(200)
    await cleanup(u, at(25))
    expect(await status(inList)).toBe(200)
  })

  it('AC-MED-1: the trigger needs a session', async () => {
    await api(app).post('/test/media-cleanup').expect(401)
  })
})
