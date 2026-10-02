import { INestApplication } from '@nestjs/common'
import { api, Client, createApp, item, listWithItems, register, RUN } from './helpers'

/** A valid 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
/** Bytes starting with a JPEG SOI/APP0 header (the server does not decode images). */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpeg-${RUN}`), Buffer.from([0xff, 0xd9])])

/** Collects any response body as a Buffer. */
const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

describe('Place details and photos (DET)', () => {
  let app: INestApplication
  const upload = (c: Client | null, body: Buffer, type = 'image/png') => {
    let t = api(app).post('/media').set('Content-Type', type)
    if (c) t = t.set('Authorization', `Bearer ${c.token}`)
    return t.send(body)
  }
  const uploadId = async (c: Client, body: Buffer = PNG) => (await upload(c, body).expect(201)).body.id as string
  const fetchMedia = (url: string) => api(app).get(url).buffer(true).parse(binary)

  beforeAll(async () => { app = await createApp() })
  afterAll(async () => { await app.close() })

  it('AC-DET-1: details are stored, normalised and returned; missing details are {}', async () => {
    const u = await register(app)
    const photo = await uploadId(u)
    const details = {
      dineIn: true, takeout: true, waitDineIn: '30-45', waitTakeout: '0-10', recommendation: 'takeout',
      spendPerPerson: 12.5, currency: 'eur', favorites: ['  Lahmacun ', '', '   ', 'Ayran'], photos: [photo],
      secret: 'dropped', nested: { x: 1 },
    }
    const { id } = await listWithItems(u, [item(101, { details }), item(102), item(103, { details: null })])
    const res = await u.get(`/lists/${id}`).expect(200)
    expect(res.body.items[0].details).toEqual({
      dineIn: true, takeout: true, waitDineIn: '30-45', waitTakeout: '0-10', recommendation: 'takeout',
      spendPerPerson: 12.5, currency: 'EUR', favorites: ['Lahmacun', 'Ayran'], photos: [photo],
    })
    expect(res.body.items[1].details).toEqual({})
    expect(res.body.items[2].details).toEqual({})

    // Re-saving the list with what GET returned keeps the details (the client round-trips them).
    const again = res.body.items.map((i: any) => ({
      provider: i.provider, providerId: i.providerId, name: i.name, category: i.category, details: i.details,
    }))
    await u.put(`/lists/${id}/items`, { items: again }).expect(200)
    expect((await u.get(`/lists/${id}`).expect(200)).body.items.map((i: any) => i.details))
      .toEqual(res.body.items.map((i: any) => i.details))

    // Partial details and boundary values.
    await u.put(`/lists/${id}/items`, {
      items: [item(101, { details: { takeout: false, spendPerPerson: 0, currency: 'TRY', favorites: [] } }),
        item(102, { details: { spendPerPerson: 100000, waitDineIn: '45+', recommendation: 'either' } })],
    }).expect(200)
    expect((await u.get(`/lists/${id}`).expect(200)).body.items.map((i: any) => i.details)).toEqual([
      { takeout: false, spendPerPerson: 0, currency: 'TRY' },
      { spendPerPerson: 100000, waitDineIn: '45+', recommendation: 'either' },
    ])
  })

  it('AC-DET-2: invalid wait range, recommendation, currency, amount, 11th favourite or 7th photo give 400', async () => {
    const u = await register(app)
    const { id } = await listWithItems(u, [])
    const photos: string[] = []
    for (let i = 0; i < 7; i++) photos.push(await uploadId(u))
    const put = (details: unknown) => u.put(`/lists/${id}/items`, { items: [item(201, { details })] })

    const bad: unknown[] = [
      { waitDineIn: '15-25' }, { waitTakeout: 30 }, { waitDineIn: '45' },
      { recommendation: 'maybe' }, { recommendation: 'TAKEOUT' },
      { currency: 'EURO' }, { currency: '€' }, { currency: 'E1R' }, { currency: 978 },
      { spendPerPerson: -1 }, { spendPerPerson: 100001 }, { spendPerPerson: '12' },
      { favorites: Array.from({ length: 11 }, (_, i) => `Yemek ${i}`) }, { favorites: ['x'.repeat(61)] },
      { favorites: 'Lahmacun' }, { favorites: [1] },
      { photos: photos.slice(0, 7) }, { photos: ['not-a-media-id'] }, { photos: photos[0] },
      { dineIn: 'yes' }, { takeout: 1 },
      [], 'details',
    ]
    for (const d of bad) {
      const res = await put(d)
      if (res.status !== 400) throw new Error(`expected 400 for ${JSON.stringify(d)}, got ${res.status}`)
      expect(res.body).toEqual({ error: expect.any(String) })
    }
    // Limits themselves are fine.
    await put({ favorites: Array.from({ length: 10 }, (_, i) => `Yemek ${i}`), photos: photos.slice(0, 6) }).expect(200)
    await put({ favorites: ['x'.repeat(60)] }).expect(200)
    // Nothing invalid was stored.
    expect((await u.get(`/lists/${id}`).expect(200)).body.items[0].details).toEqual({ favorites: ['x'.repeat(60)] })
  })

  it('AC-DET-3: images upload and come back byte-for-byte; wrong type 415, over 5 MB 413, no session 401, unknown id 404', async () => {
    const u = await register(app)
    const res = await upload(u, PNG).expect(201)
    expect(res.body).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), url: `/media/${res.body.id}` })
    const got = await fetchMedia(res.body.url).expect(200) // public: no Authorization header
    expect(got.headers['content-type']).toBe('image/png')
    expect(got.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(Buffer.compare(got.body, PNG)).toBe(0)

    const jpeg = await upload(u, JPEG, 'image/jpeg').expect(201)
    expect(jpeg.body.id).not.toBe(res.body.id)
    const gotJpeg = await fetchMedia(jpeg.body.url).expect(200)
    expect(gotJpeg.headers['content-type']).toBe('image/jpeg')
    expect(Buffer.compare(gotJpeg.body, JPEG)).toBe(0)
    const webp = await upload(u, Buffer.from(`RIFF....WEBPVP8 ${RUN}`), 'image/webp').expect(201)
    expect((await fetchMedia(webp.body.url).expect(200)).headers['content-type']).toBe('image/webp')

    for (const type of ['text/plain', 'image/gif', 'application/octet-stream', 'image/svg+xml']) {
      const r = await upload(u, PNG, type)
      expect([type, r.status]).toEqual([type, 415])
      expect(r.body).toEqual({ error: expect.any(String) })
    }
    const big = await upload(u, Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'image/jpeg')
    expect(big.status).toBe(413)
    expect(big.body).toEqual({ error: expect.any(String) })
    await upload(u, Buffer.alloc(0)).expect(400)
    await upload(null, PNG).expect(401)
    await upload(null, PNG, 'text/plain').expect(401)

    await fetchMedia(`/media/${'0'.repeat(32)}`).expect(404)
    await fetchMedia('/media/not-an-id').expect(404)
  })

  it('AC-DET-4: another user\'s media id cannot be put on a list (400)', async () => {
    const owner = await register(app)
    const other = await register(app)
    const theirs = await uploadId(other)
    const mine = await uploadId(owner)
    const { id } = await listWithItems(owner, [])
    await owner.put(`/lists/${id}/items`, { items: [item(401, { details: { photos: [theirs] } })] }).expect(400)
    await owner.put(`/lists/${id}/items`, { items: [item(401, { details: { photos: [mine, theirs] } })] }).expect(400)
    await owner.put(`/lists/${id}/items`, { items: [item(401, { details: { photos: ['f'.repeat(32)] } })] }).expect(400)
    await owner.put(`/lists/${id}/items`, { items: [item(401, { details: { photos: [mine] } })] }).expect(200)
    expect((await owner.get(`/lists/${id}`).expect(200)).body.items[0].details).toEqual({ photos: [mine] })
  })

  it('AC-DET-5: details of a private list are hidden from others; a public list shows them to everyone', async () => {
    const owner = await register(app)
    const other = await register(app)
    const photo = await uploadId(owner)
    const details = { takeout: true, waitTakeout: '10-20', spendPerPerson: 9, currency: 'GBP', favorites: ['Fish & chips'], photos: [photo] }
    const { id } = await listWithItems(owner, [item(501, { details })], { visibility: 'private' })
    await other.get(`/lists/${id}`).expect(404)
    expect((await owner.get(`/lists/${id}`).expect(200)).body.items[0].details).toEqual(details)
    await owner.patch(`/lists/${id}`, { visibility: 'public' }).expect(200)
    expect((await other.get(`/lists/${id}`).expect(200)).body.items[0].details).toEqual(details)
    await fetchMedia(`/media/${photo}`).expect(200)
  })

  it('AC-DET-6: deleting the account deletes that user\'s media', async () => {
    const u = await register(app)
    const keep = await register(app)
    const a = await uploadId(u)
    const b = await uploadId(u, JPEG)
    const kept = await uploadId(keep)
    await listWithItems(u, [item(601, { details: { photos: [a, b] } })], { visibility: 'public' })
    await fetchMedia(`/media/${a}`).expect(200)
    await u.del('/me').expect(200)
    await fetchMedia(`/media/${a}`).expect(404)
    await fetchMedia(`/media/${b}`).expect(404)
    await fetchMedia(`/media/${kept}`).expect(200)
  })

  describe('comment photos', () => {
    let placeId: number
    beforeAll(async () => {
      const owner = await register(app)
      placeId = (await listWithItems(owner, [item(701)])).placeIds[0]
    })
    const comments = async (c: Client) => (await c.get(`/places/${placeId}/comments`).expect(200)).body as any[]

    it('AC-DET-7: comments with photos are saved and returned; 5th photo, foreign media, or no text and no photo give 400', async () => {
      const w = await register(app)
      const stranger = await register(app)
      const p = [await uploadId(w), await uploadId(w, JPEG), await uploadId(w), await uploadId(w), await uploadId(w)]
      const foreign = await uploadId(stranger)

      const withText = await w.post(`/places/${placeId}/comments`, { body: 'Çok güzel', photos: p.slice(0, 2) }).expect(201)
      const onlyPhotos = await w.post(`/places/${placeId}/comments`, { body: '  ', photos: p.slice(0, 4) }).expect(201)
      const noBody = await w.post(`/places/${placeId}/comments`, { photos: [p[4]] }).expect(201)
      const all = await comments(stranger)
      expect(all.find((c) => c.id === withText.body.id)).toMatchObject({ body: 'Çok güzel', photos: p.slice(0, 2) })
      expect(all.find((c) => c.id === onlyPhotos.body.id)).toMatchObject({ body: '', photos: p.slice(0, 4) })
      expect(all.find((c) => c.id === noBody.body.id)).toMatchObject({ body: '', photos: [p[4]] })

      const w2 = await register(app) // a fresh author: the rate limit allows 5 comments a minute
      const q = [await uploadId(w2), await uploadId(w2), await uploadId(w2), await uploadId(w2), await uploadId(w2)]
      for (const body of [
        { body: 'x', photos: q }, // 5 photos
        { body: 'x', photos: [foreign] }, { body: 'x', photos: [q[0], foreign] },
        { body: 'x', photos: ['nope'] }, { body: 'x', photos: q[0] },
        { body: '' }, { body: '   ', photos: [] }, {}, { photos: [] },
      ]) {
        const res = await w2.post(`/places/${placeId}/comments`, body)
        if (res.status !== 400) throw new Error(`expected 400 for ${JSON.stringify(body)}, got ${res.status}`)
      }
      const plain = await w2.post(`/places/${placeId}/comments`, { body: 'no photos' }).expect(201)
      expect((await comments(w2)).find((c) => c.id === plain.body.id)).toMatchObject({ photos: [] })
    })

    it('AC-DET-7: photos of a "Sadece ben" (private) comment are not returned to anyone else', async () => {
      const w = await register(app)
      const other = await register(app)
      const photo = await uploadId(w)
      const priv = await w.post(`/places/${placeId}/comments`, { body: '', photos: [photo], visibility: 'private' }).expect(201)
      const friends = await w.post(`/places/${placeId}/comments`, { body: 'f', photos: [photo], visibility: 'friends' }).expect(201)
      expect((await comments(w)).find((c) => c.id === priv.body.id)).toMatchObject({ photos: [photo] })
      const seen = await comments(other)
      expect(seen.map((c) => c.id)).not.toContain(priv.body.id)
      expect(seen.map((c) => c.id)).not.toContain(friends.body.id)
      expect(seen.flatMap((c) => c.photos)).not.toContain(photo)
    })
  })
})
