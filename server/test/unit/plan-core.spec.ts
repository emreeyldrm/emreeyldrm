import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_OVERPASS_URL, DEFAULT_ROUTING_URL, fakeHours, fakeWalk, fetchHours, GOOGLE_HOURS_FIELD_MASK,
  GOOGLE_ROUTES_FIELD_MASK, googlePeriodsToOsm, HOURS_TTL_MS, osrmUrl, overpassQuery, parsePoints, pickHoursProvider,
  pickRoutingProvider, PlanError, readHoursRow, resolveHours, USER_AGENT, walkRoute, type FetchLike, type HoursRow,
} from '../../src/plan/plan-core'

const root = join(__dirname, '..', '..', '..')

type Call = { url: string; init?: Parameters<FetchLike>[1] }
function mockFetch(responses: Array<{ ok?: boolean; status?: number; body?: unknown; throws?: boolean }>) {
  const calls: Call[] = []
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (r.throws) throw new Error('network down')
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body }
  }
  return { fn, calls }
}
const neverFetch: FetchLike = async () => { throw new Error('fetch must not be called') }

const A = { lat: 41.8902, lon: 12.4922 }
const B = { lat: 41.8937, lon: 12.4731 }
const C = { lat: 41.8986, lon: 12.4755 }

describe('plan-core', () => {
  it('is byte-identical in server/ (NestJS) and backend/ (Worker)', () => {
    const nest = readFileSync(join(root, 'server', 'src', 'plan', 'plan-core.ts'), 'utf8')
    const worker = readFileSync(join(root, 'backend', 'src', 'plan-core.ts'), 'utf8')
    expect(worker).toBe(nest)
  })

  describe('parsePoints', () => {
    it('accepts 2–25 "lat,lon" pairs separated by ";"', () => {
      expect(parsePoints('41.1,12.5; -33.9 , 151.2')).toEqual([{ lat: 41.1, lon: 12.5 }, { lat: -33.9, lon: 151.2 }])
      expect(parsePoints(Array.from({ length: 25 }, () => '1,2').join(';'))).toHaveLength(25)
    })
    it.each([undefined, '', '1,2', Array.from({ length: 26 }, () => '1,2').join(';'), '1,2;x,y', '1;2', '91,0;0,1',
      '0,181;0,1', '1,2;;3,4', '1e2,3;4,5', ['1,2', '3,4']])('rejects %p with 400', (raw) => {
      expect(() => parsePoints(raw)).toThrow(PlanError)
      try { parsePoints(raw) } catch (e) { expect((e as PlanError).status).toBe(400) }
    })
  })

  describe('provider selection', () => {
    it('routing: explicit wins, SEARCH_PROVIDER=fake -> fake, key -> google, else osrm', () => {
      expect(pickRoutingProvider({ ROUTING_PROVIDER: 'osrm', SEARCH_PROVIDER: 'fake' })).toBe('osrm')
      expect(pickRoutingProvider({ SEARCH_PROVIDER: 'fake', GOOGLE_PLACES_API_KEY: 'k' })).toBe('fake')
      expect(pickRoutingProvider({ GOOGLE_PLACES_API_KEY: 'k' })).toBe('google')
      expect(pickRoutingProvider({ GOOGLE_ROUTES_API_KEY: 'k' })).toBe('google')
      expect(pickRoutingProvider({})).toBe('osrm')
      expect(pickRoutingProvider({ ROUTING_PROVIDER: ' FAKE ' })).toBe('fake')
    })
    it('hours: fake by env, else by the place provider (google only with a key)', () => {
      const osm = { provider: 'osm', providerId: 'N1' }
      const g = { provider: 'google', providerId: 'ChIJ' }
      expect(pickHoursProvider({ HOURS_PROVIDER: 'fake' }, osm)).toBe('fake')
      expect(pickHoursProvider({ SEARCH_PROVIDER: 'fake' }, osm)).toBe('fake')
      expect(pickHoursProvider({ SEARCH_PROVIDER: 'fake', HOURS_PROVIDER: 'osm' }, osm)).toBe('osm')
      expect(pickHoursProvider({}, osm)).toBe('osm')
      expect(pickHoursProvider({}, g)).toBe('none')
      expect(pickHoursProvider({ GOOGLE_PLACES_API_KEY: 'k' }, g)).toBe('google')
      expect(pickHoursProvider({ GOOGLE_PLACES_API_KEY: 'k' }, { provider: 'voyage', providerId: 'x' })).toBe('none')
    })
  })

  describe('walking routes', () => {
    it('fake: straight line × 1.3 at 4.8 km/h, totals are sums, 0,0 fails with 502; never calls fetch', async () => {
      const r = await walkRoute({ ROUTING_PROVIDER: 'fake' }, [A, B, C], neverFetch)
      expect(r.provider).toBe('fake')
      expect(r.legs).toHaveLength(2)
      expect(r.totalDistanceM).toBe(r.legs[0].distanceM + r.legs[1].distanceM)
      expect(Math.abs(r.legs[0].durationS - r.legs[0].distanceM / (4800 / 3600))).toBeLessThanOrEqual(1)
      expect(() => fakeWalk([A, { lat: 0, lon: 0 }])).toThrow(PlanError)
    })

    it('OSRM: lon,lat URL on the configured server, legs parsed and rounded', async () => {
      expect(osrmUrl([A, B])).toBe(`${DEFAULT_ROUTING_URL}/route/v1/foot/12.4922,41.8902;12.4731,41.8937?overview=false&steps=false`)
      expect(osrmUrl([A, B], 'http://osrm.local/')).toMatch(/^http:\/\/osrm\.local\/route\/v1\/foot\//)
      const { fn, calls } = mockFetch([{ body: { code: 'Ok', routes: [{ legs: [{ distance: 1520.4, duration: 1100.6 }, { distance: 620, duration: 450 }] }] } }])
      const r = await walkRoute({ ROUTING_URL: 'http://osrm.local' }, [A, B, C], fn)
      expect(r).toEqual({ legs: [{ distanceM: 1520, durationS: 1101 }, { distanceM: 620, durationS: 450 }], totalDistanceM: 2140, totalDurationS: 1551, provider: 'osrm' })
      expect(calls[0].url.startsWith('http://osrm.local/route/v1/foot/')).toBe(true)
      expect(calls[0].init?.headers?.['User-Agent']).toBe(USER_AGENT)
      expect(calls[0].init?.signal).toBeDefined()
    })

    it('OSRM: NoRoute, wrong leg count, HTTP error and network error -> 502', async () => {
      for (const resp of [
        { body: { code: 'NoRoute', routes: [] } },
        { body: { code: 'Ok', routes: [{ legs: [{ distance: 1, duration: 1 }] }] } },
        { ok: false, status: 429, body: {} },
        { throws: true },
      ]) {
        await expect(walkRoute({ ROUTING_PROVIDER: 'osrm' }, [A, B, C], mockFetch([resp]).fn)).rejects.toMatchObject({ status: 502 })
      }
    })

    it('Google Routes: computeRoutes WALK with intermediates, key header and field mask; "754s" durations', async () => {
      const { fn, calls } = mockFetch([{ body: { routes: [{ legs: [{ distanceMeters: 1400, duration: '1012s' }, { duration: '0s' }] }] } }])
      const r = await walkRoute({ GOOGLE_ROUTES_API_KEY: 'secret-key' }, [A, B, C], fn)
      expect(r).toEqual({ legs: [{ distanceM: 1400, durationS: 1012 }, { distanceM: 0, durationS: 0 }], totalDistanceM: 1400, totalDurationS: 1012, provider: 'google' })
      expect(calls[0].url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
      expect(calls[0].init?.method).toBe('POST')
      expect(calls[0].init?.headers?.['X-Goog-Api-Key']).toBe('secret-key')
      expect(calls[0].init?.headers?.['X-Goog-FieldMask']).toBe(GOOGLE_ROUTES_FIELD_MASK)
      expect(calls[0].url).not.toContain('secret-key')
      const body = JSON.parse(calls[0].init?.body ?? '{}')
      expect(body.travelMode).toBe('WALK')
      expect(body.origin.location.latLng).toEqual({ latitude: A.lat, longitude: A.lon })
      expect(body.destination.location.latLng).toEqual({ latitude: C.lat, longitude: C.lon })
      expect(body.intermediates).toHaveLength(1)
      // Places key is used when no dedicated Routes key is set; empty routes -> 502 without leaking the key
      const empty = mockFetch([{ body: {} }])
      await expect(walkRoute({ GOOGLE_PLACES_API_KEY: 'pk' }, [A, B], empty.fn)).rejects.toMatchObject({ status: 502 })
      expect(empty.calls[0].init?.headers?.['X-Goog-Api-Key']).toBe('pk')
      expect(JSON.parse(empty.calls[0].init?.body ?? '{}').intermediates).toBeUndefined()
      await expect(walkRoute({ ROUTING_PROVIDER: 'google' }, [A, B], neverFetch)).rejects.toMatchObject({ status: 502 })
    })
  })

  describe('opening hours', () => {
    it('fake: by providerId prefix; unknown -> null; "__fail__" -> 502', () => {
      expect(fakeHours({ provider: 'fake', providerId: 'fake-roscioli' })).toBe('Mo-Sa 12:30-16:00,19:00-23:00; Su off')
      expect(fakeHours({ provider: 'fake', providerId: 'fake-villa-borghese-x1' })).toBe('24/7')
      expect(fakeHours({ provider: 'fake', providerId: 'fake-hours-abc' })).toBe('Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off')
      expect(fakeHours({ provider: 'voyage', providerId: 'v-1' })).toBeNull()
      expect(() => fakeHours({ provider: 'fake', providerId: 'x-__fail__' })).toThrow(PlanError)
    })

    it('Overpass: query by OSM type + id, form POST, tag parsed; missing element/tag -> null', async () => {
      expect(overpassQuery('N123')).toBe('[out:json][timeout:10];node(123);out tags;')
      expect(overpassQuery('W456')).toContain('way(456)')
      expect(overpassQuery('r789')).toContain('relation(789)')
      expect(overpassQuery('X1')).toBeNull()
      expect(overpassQuery('N12a')).toBeNull()
      const { fn, calls } = mockFetch([{ body: { elements: [{ type: 'node', id: 123, tags: { name: 'X', opening_hours: ' Mo-Fr 09:00-18:00 ' } }] } }])
      expect(await fetchHours({}, { provider: 'osm', providerId: 'N123' }, fn)).toEqual({ openingHours: 'Mo-Fr 09:00-18:00', source: 'osm' })
      expect(calls[0].url).toBe(DEFAULT_OVERPASS_URL)
      expect(calls[0].init?.method).toBe('POST')
      expect(calls[0].init?.headers?.['User-Agent']).toBe(USER_AGENT)
      expect(decodeURIComponent((calls[0].init?.body ?? '').replace(/^data=/, ''))).toBe('[out:json][timeout:10];node(123);out tags;')
      const custom = mockFetch([{ body: { elements: [{ tags: { name: 'no hours' } }] } }])
      expect(await fetchHours({ OVERPASS_URL: 'http://op.local/api' }, { provider: 'osm', providerId: 'W9' }, custom.fn))
        .toEqual({ openingHours: null, source: 'osm' })
      expect(custom.calls[0].url).toBe('http://op.local/api')
      expect(await fetchHours({}, { provider: 'osm', providerId: 'N5' }, mockFetch([{ body: { elements: [] } }]).fn))
        .toEqual({ openingHours: null, source: 'osm' })
      // malformed id: no request at all
      expect(await fetchHours({}, { provider: 'osm', providerId: 'bogus' }, neverFetch)).toEqual({ openingHours: null, source: 'osm' })
      await expect(fetchHours({}, { provider: 'osm', providerId: 'N1' }, mockFetch([{ ok: false, status: 504 }]).fn)).rejects.toMatchObject({ status: 502 })
      await expect(fetchHours({}, { provider: 'osm', providerId: 'N1' }, mockFetch([{ body: { remark: 'timeout' } }]).fn)).rejects.toMatchObject({ status: 502 })
    })

    it('Google Place Details: field mask + key header; periods -> OSM text', async () => {
      const periods = (list: [number, number, number, number, number, number][]) => ({
        regularOpeningHours: { periods: list.map(([od, oh, om, cd, ch, cm]) => ({ open: { day: od, hour: oh, minute: om }, close: { day: cd, hour: ch, minute: cm } })) },
      })
      const weekdays: [number, number, number, number, number, number][] = [1, 2, 3, 4, 5].map((d) => [d, 9, 0, d, 18, 0])
      const { fn, calls } = mockFetch([{ body: periods([...weekdays, [6, 10, 0, 6, 14, 0]]) }])
      expect(await fetchHours({ GOOGLE_PLACES_API_KEY: 'gk' }, { provider: 'google', providerId: 'ChIJabc' }, fn))
        .toEqual({ openingHours: 'Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off', source: 'google' })
      expect(calls[0].url).toBe('https://places.googleapis.com/v1/places/ChIJabc')
      expect(calls[0].init?.headers).toEqual({ 'X-Goog-Api-Key': 'gk', 'X-Goog-FieldMask': GOOGLE_HOURS_FIELD_MASK })

      expect(googlePeriodsToOsm({ regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } })).toBe('24/7')
      // overnight (closes next day 02:00), split lunch, two-day group
      expect(googlePeriodsToOsm(periods([
        [5, 18, 0, 6, 2, 0], [6, 18, 0, 0, 2, 0],
        [1, 12, 0, 1, 15, 0], [1, 19, 0, 1, 23, 0], [2, 12, 0, 2, 15, 0], [2, 19, 0, 2, 23, 0],
      ]))).toBe('Mo,Tu 12:00-15:00,19:00-23:00; We,Th off; Fr,Sa 18:00-02:00; Su off')
      // closes at midnight -> 24:00; a period spanning several days is split
      expect(googlePeriodsToOsm(periods([[1, 20, 0, 2, 0, 0]]))).toBe('Mo 20:00-24:00; Tu-Su off')
      expect(googlePeriodsToOsm(periods([[1, 8, 0, 3, 12, 0]]))).toBe('Mo 08:00-24:00; Tu 00:00-24:00; We 00:00-12:00; Th-Su off')
      // no periods (weekdayDescriptions only, localized) -> null
      expect(googlePeriodsToOsm({ regularOpeningHours: { weekdayDescriptions: ['Pazartesi: 09:00–18:00'] } })).toBeNull()
      expect(googlePeriodsToOsm({})).toBeNull()
      // no key -> none, no request
      expect(await fetchHours({ HOURS_PROVIDER: 'google' }, { provider: 'google', providerId: 'x' }, neverFetch)).toEqual({ openingHours: null, source: 'none' })
    })

    it('resolveHours: fresh cache skips the provider; stale refetches; provider error serves stale or 502', async () => {
      const place = { provider: 'osm', providerId: 'N1' }
      const t0 = new Date('2026-05-01T08:00:00Z')
      const cached: HoursRow = { openingHours: 'Mo-Su 10:00-20:00', source: 'osm', fetchedAt: t0.toISOString() }
      const fresh = await resolveHours({}, place, cached, new Date(t0.getTime() + HOURS_TTL_MS - 1000), neverFetch)
      expect(fresh).toEqual({ response: cached, store: null })

      const later = new Date(t0.getTime() + HOURS_TTL_MS + 1000)
      const ok = mockFetch([{ body: { elements: [{ tags: { opening_hours: '24/7' } }] } }])
      const refreshed = await resolveHours({}, place, cached, later, ok.fn)
      expect(refreshed.store).toEqual({ openingHours: '24/7', source: 'osm', fetchedAt: later.toISOString() })
      expect(refreshed.response).toEqual(refreshed.store)
      expect(ok.calls).toHaveLength(1)

      const down = mockFetch([{ throws: true }])
      expect(await resolveHours({}, place, cached, later, down.fn)).toEqual({ response: cached, store: null })
      await expect(resolveHours({}, place, null, later, down.fn)).rejects.toMatchObject({ status: 502 })
      // Google content is served but never stored
      const g = mockFetch([{ body: { regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } } }])
      const google = await resolveHours({ GOOGLE_PLACES_API_KEY: 'k' }, { provider: 'google', providerId: 'ChIJ1' }, null, t0, g.fn)
      expect(google).toEqual({ response: { openingHours: '24/7', source: 'google', fetchedAt: t0.toISOString() }, store: null })
      // a "no hours" row is cached too
      const none = await resolveHours({ HOURS_PROVIDER: 'fake' }, { provider: 'fake', providerId: 'nothing' }, null, t0, neverFetch)
      expect(none.store).toEqual({ openingHours: null, source: 'fake', fetchedAt: t0.toISOString() })
    })

    it('readHoursRow normalizes database rows', () => {
      expect(readHoursRow(undefined)).toBeNull()
      expect(readHoursRow({ openingHours: null, source: 'fake', fetchedAt: '2026-01-01T00:00:00.000Z' }))
        .toEqual({ openingHours: null, source: 'fake', fetchedAt: '2026-01-01T00:00:00.000Z' })
      expect(readHoursRow({ openingHours: '24/7', source: 'weird', fetchedAt: 'x' })?.source).toBe('none')
    })
  })
})
