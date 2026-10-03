import { INestApplication } from '@nestjs/common'
import { createApp, item, listWithItems, register } from './helpers'

describe('Google list import (IMP)', () => {
  let app: INestApplication
  beforeAll(async () => { app = await createApp() })
  afterAll(async () => { await app.close() })

  it('AC-IMP-1: googleMapsUrl is stored and returned; an invalid host/scheme gives 400', async () => {
    const u = await register(app)
    const good = [
      'https://www.google.com/maps/place/Roscioli/@41.89,12.47,17z/data=!4m6!3m5!1s0x0:0x1',
      'https://maps.google.com/?cid=1234567890123456789',
      'https://goo.gl/maps/AbCdEf123',
      'https://maps.app.goo.gl/XyZ987',
      'https://www.google.com/maps/search/?api=1&query=' + 'a'.repeat(500 - 48),
    ]
    expect(good[4].length).toBe(500)
    const { id } = await listWithItems(u, good.map((url, i) => item(901 + i, {
      note: i === 0 ? 'Carbonara!' : undefined, details: { googleMapsUrl: url, takeout: true },
    })))
    const res = await u.get(`/lists/${id}`).expect(200)
    expect(res.body.items.map((i: any) => i.details.googleMapsUrl)).toEqual(good)
    expect(res.body.items[0]).toMatchObject({ note: 'Carbonara!', details: { googleMapsUrl: good[0], takeout: true } })

    // Round-tripping what GET returned keeps the link.
    const again = res.body.items.map((i: any) => ({
      provider: i.provider, providerId: i.providerId, name: i.name, category: i.category, details: i.details,
    }))
    await u.put(`/lists/${id}/items`, { items: again }).expect(200)
    expect((await u.get(`/lists/${id}`).expect(200)).body.items.map((i: any) => i.details.googleMapsUrl)).toEqual(good)

    const bad: unknown[] = [
      'http://www.google.com/maps/place/x', // not https
      'javascript:alert(1)', 'ftp://maps.google.com/x', '//www.google.com/maps/x', 'www.google.com/maps/x',
      'https://evil.com/maps/place/x', 'https://www.google.com.evil.com/maps/x', 'https://google.com.tr/maps/x',
      'https://www.google.com/search?q=x', // google.com but not /maps
      'https://goo.gl/abc', // goo.gl but not /maps
      'https://user:pw@www.google.com/maps/x', 'https://www.google.com:8443/maps/x',
      'https://www.google.com/maps/search/?api=1&query=' + 'a'.repeat(501 - 48), // 501 characters
      '', 12, true, ['https://maps.app.goo.gl/x'], { url: 'https://maps.app.goo.gl/x' },
    ]
    for (const googleMapsUrl of bad) {
      const r = await u.put(`/lists/${id}/items`, { items: [item(990, { details: { googleMapsUrl } })] })
      if (r.status !== 400) throw new Error(`expected 400 for ${JSON.stringify(googleMapsUrl)}, got ${r.status}`)
      expect(r.body).toEqual({ error: expect.any(String) })
    }
    // Nothing invalid replaced the stored list.
    expect((await u.get(`/lists/${id}`).expect(200)).body.items).toHaveLength(good.length)
  })
})
