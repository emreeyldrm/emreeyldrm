import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  categoryFromGoogle, categoryFromOsm, fakeSearch, fold, GOOGLE_FIELD_MASK, parseGoogle, parsePhoton,
  parseSearchQuery, pickProvider, searchPlaces, SearchError, USER_AGENT, type FetchLike,
} from '../../src/search/search-core'

const root = join(__dirname, '..', '..', '..')

describe('search-core', () => {
  it('is byte-identical in server/ (NestJS) and backend/ (Worker)', () => {
    const nest = readFileSync(join(root, 'server', 'src', 'search', 'search-core.ts'), 'utf8')
    const worker = readFileSync(join(root, 'backend', 'src', 'search-core.ts'), 'utf8')
    expect(worker).toBe(nest)
  })

  describe('categoryFromGoogle', () => {
    const cases: [string, string[], string][] = [
      ['restaurant', [], 'food'],
      ['italian_restaurant', ['restaurant', 'food'], 'food'],
      ['meal_takeaway', [], 'food'],
      ['bakery', [], 'food'],
      ['cafe', ['food', 'point_of_interest'], 'coffee'],
      ['coffee_shop', [], 'coffee'],
      ['bar', [], 'bar'],
      ['night_club', [], 'bar'],
      ['pub', [], 'bar'],
      ['wine_bar', [], 'bar'],
      ['museum', [], 'museum'],
      ['art_gallery', [], 'museum'],
      ['historical_landmark', [], 'historic'],
      ['tourist_attraction', ['tourist_attraction', 'church', 'place_of_worship'], 'historic'],
      ['tourist_attraction', ['mosque'], 'historic'],
      ['tourist_attraction', ['monument'], 'historic'],
      ['place_of_worship', [], 'historic'],
      ['park', [], 'park'],
      ['national_park', [], 'park'],
      ['garden', [], 'park'],
      ['beach', [], 'beach'],
      ['lodging', [], 'hotel'],
      ['hotel', ['lodging'], 'hotel'],
      ['airport', [], 'airport'],
      ['tourist_attraction', ['point_of_interest', 'establishment'], 'other'],
      ['', ['point_of_interest'], 'other'],
      ['shopping_mall', [], 'other'],
    ]
    it.each(cases)('%s %j -> %s', (primary, types, expected) => {
      expect(categoryFromGoogle(primary, types)).toBe(expected)
    })
    it('the primary type wins over other types; missing input is other', () => {
      expect(categoryFromGoogle('cafe', ['restaurant', 'bar'])).toBe('coffee')
      expect(categoryFromGoogle(undefined, ['lodging'])).toBe('hotel')
      expect(categoryFromGoogle(null, null)).toBe('other')
    })
  })

  describe('categoryFromOsm', () => {
    const cases: [string, string, string][] = [
      ['amenity', 'restaurant', 'food'], ['amenity', 'fast_food', 'food'], ['amenity', 'food_court', 'food'],
      ['amenity', 'cafe', 'coffee'],
      ['amenity', 'bar', 'bar'], ['amenity', 'pub', 'bar'], ['amenity', 'biergarten', 'bar'], ['amenity', 'nightclub', 'bar'],
      ['tourism', 'museum', 'museum'], ['tourism', 'gallery', 'museum'],
      ['historic', 'castle', 'historic'], ['historic', 'monument', 'historic'], ['historic', 'yes', 'historic'],
      ['amenity', 'place_of_worship', 'historic'],
      ['leisure', 'park', 'park'], ['leisure', 'garden', 'park'],
      ['natural', 'beach', 'beach'],
      ['tourism', 'hotel', 'hotel'], ['tourism', 'hostel', 'hotel'], ['tourism', 'guest_house', 'hotel'],
      ['aeroway', 'aerodrome', 'airport'],
      ['amenity', 'bank', 'other'], ['place', 'city', 'other'], ['highway', 'residential', 'other'], ['tourism', 'attraction', 'other'],
    ]
    it.each(cases)('%s=%s -> %s', (key, value, expected) => {
      expect(categoryFromOsm(key, value)).toBe(expected)
    })
    it('missing key is other', () => {
      expect(categoryFromOsm(undefined, 'cafe')).toBe('other')
      expect(categoryFromOsm('amenity', null)).toBe('other')
    })
  })

  it('parseSearchQuery validates q and lat/lon', () => {
    expect(parseSearchQuery(' roma ', undefined, undefined)).toEqual({ q: 'roma', near: null })
    expect(parseSearchQuery('roma', '41.9', '12.5')).toEqual({ q: 'roma', near: { lat: 41.9, lon: 12.5 } })
    expect(parseSearchQuery('roma', '', '')).toEqual({ q: 'roma', near: null })
    for (const [q, lat, lon] of [[undefined, undefined, undefined], ['a', undefined, undefined], ['  ', undefined, undefined],
      ['roma', '41', undefined], ['roma', 'x', '12'], ['roma', '91', '0'], ['roma', '0', '181'], [['ro', 'ma'], undefined, undefined]]) {
      expect(() => parseSearchQuery(q, lat, lon)).toThrow(SearchError)
    }
    try { parseSearchQuery('a', undefined, undefined) } catch (e) { expect((e as SearchError).status).toBe(400) }
  })

  it('pickProvider: SEARCH_PROVIDER wins, then Google when a key is set, else Photon', () => {
    expect(pickProvider({})).toBe('photon')
    expect(pickProvider({ GOOGLE_PLACES_API_KEY: 'k' })).toBe('google')
    expect(pickProvider({ GOOGLE_PLACES_API_KEY: 'k', SEARCH_PROVIDER: 'photon' })).toBe('photon')
    expect(pickProvider({ GOOGLE_PLACES_API_KEY: 'k', SEARCH_PROVIDER: 'fake' })).toBe('fake')
    expect(pickProvider({ SEARCH_PROVIDER: 'GOOGLE' })).toBe('google')
    expect(pickProvider({ SEARCH_PROVIDER: 'bogus' })).toBe('photon')
  })

  it('fold ignores case and Turkish/Latin diacritics', () => {
    expect(fold('İSTANBUL Çiya Şişli Ağaç Göztepe Üsküdar ılık Caffè')).toBe('istanbul ciya sisli agac goztepe uskudar ilik caffe')
  })

  it('fakeSearch filters by name/address and sorts by distance', () => {
    expect(fakeSearch({ q: 'kulesi', near: null }).map((r) => r.providerId)).toEqual(['fake-galata'])
    expect(fakeSearch({ q: 'hilton', near: { lat: 41.9, lon: 12.5 } }).map((r) => r.providerId)).toEqual(['fake-hilton-roma', 'fake-hilton-istanbul'])
    expect(fakeSearch({ q: 'hilton', near: { lat: 41.0, lon: 29.0 } }).map((r) => r.providerId)).toEqual(['fake-hilton-istanbul', 'fake-hilton-roma'])
    expect(fakeSearch({ q: 'al', near: null })).toHaveLength(8)
    expect(() => fakeSearch({ q: '__fail__', near: null })).toThrow(SearchError)
  })

  describe('Google provider (mocked fetch)', () => {
    const googleJson = {
      places: [
        {
          id: 'ChIJrRMgU7ZhLxMRxAOFkC7I8Sg', displayName: { text: 'Colosseo', languageCode: 'it' },
          formattedAddress: 'Piazza del Colosseo, 1, 00184 Roma RM, İtalya',
          location: { latitude: 41.8902102, longitude: 12.4922309 },
          primaryType: 'historical_landmark', types: ['historical_landmark', 'tourist_attraction', 'point_of_interest'],
        },
        {
          id: 'ChIJcafe', displayName: { text: "Sant'Eustachio Il Caffè" }, formattedAddress: 'Roma',
          location: { latitude: 41.8986, longitude: 12.4755 }, types: ['cafe', 'food', 'store'],
        },
        { id: 'no-location', displayName: { text: 'Broken' } },
        { displayName: { text: 'No id' }, location: { latitude: 1, longitude: 2 } },
      ],
    }

    it('sends the Text Search request with key, field mask, Turkish language and location bias', async () => {
      const calls: { url: string; init: any }[] = []
      const fetchFn: FetchLike = async (url, init) => {
        calls.push({ url, init })
        return { ok: true, status: 200, json: async () => googleJson }
      }
      const res = await searchPlaces({ GOOGLE_PLACES_API_KEY: 'secret-key' }, { q: 'colosseo', near: { lat: 41.9, lon: 12.5 } }, fetchFn)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://places.googleapis.com/v1/places:searchText')
      expect(calls[0].init.method).toBe('POST')
      expect(calls[0].init.headers).toMatchObject({ 'X-Goog-Api-Key': 'secret-key', 'X-Goog-FieldMask': GOOGLE_FIELD_MASK })
      expect(calls[0].init.signal).toBeDefined()
      expect(JSON.parse(calls[0].init.body)).toEqual({
        textQuery: 'colosseo', languageCode: 'tr', maxResultCount: 8,
        locationBias: { circle: { center: { latitude: 41.9, longitude: 12.5 }, radius: 20000 } },
      })
      expect(res).toEqual([
        { provider: 'google', providerId: 'ChIJrRMgU7ZhLxMRxAOFkC7I8Sg', name: 'Colosseo', address: 'Piazza del Colosseo, 1, 00184 Roma RM, İtalya', lat: 41.8902102, lon: 12.4922309, category: 'historic' },
        { provider: 'google', providerId: 'ChIJcafe', name: "Sant'Eustachio Il Caffè", address: 'Roma', lat: 41.8986, lon: 12.4755, category: 'coffee' },
      ])
    })

    it('omits locationBias without lat/lon; tolerates odd payloads', async () => {
      let body: any
      await searchPlaces({ GOOGLE_PLACES_API_KEY: 'k' }, { q: 'x y', near: null }, async (_u, init) => {
        body = JSON.parse(init!.body!)
        return { ok: true, status: 200, json: async () => ({}) }
      })
      expect(body.locationBias).toBeUndefined()
      expect(parseGoogle(null)).toEqual([])
      expect(parseGoogle({ places: 'nope' })).toEqual([])
    })

    it('HTTP errors, network errors/timeouts and bad JSON become 502 without leaking the key', async () => {
      const failing: FetchLike[] = [
        async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API key secret-key invalid' } }) }),
        async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) },
        async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } }),
      ]
      for (const f of failing) {
        const err = await searchPlaces({ GOOGLE_PLACES_API_KEY: 'secret-key' }, { q: 'roma', near: null }, f).catch((e) => e)
        expect(err).toBeInstanceOf(SearchError)
        expect(err.status).toBe(502)
        expect(err.message).not.toContain('secret-key')
      }
      const forced = await searchPlaces({ SEARCH_PROVIDER: 'google' }, { q: 'roma', near: null }, async () => { throw new Error('unused') }).catch((e) => e)
      expect(forced.status).toBe(502)
    })
  })

  describe('Photon provider (mocked fetch)', () => {
    const photonJson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature', geometry: { type: 'Point', coordinates: [28.9741, 41.0256] },
          properties: { osm_type: 'W', osm_id: 24618397, osm_key: 'historic', osm_value: 'tower', name: 'Galata Kulesi', street: 'Galata Kulesi Sokağı', city: 'İstanbul', country: 'Türkiye' },
        },
        {
          type: 'Feature', geometry: { type: 'Point', coordinates: [12.4755, 41.8986] },
          properties: { osm_type: 'N', osm_id: 123, osm_key: 'amenity', osm_value: 'cafe', name: "Sant'Eustachio", street: "Piazza di Sant'Eustachio", housenumber: '82', city: 'Roma', country: 'Italia' },
        },
        {
          type: 'Feature', geometry: { type: 'Point', coordinates: [12.49, 41.89] },
          properties: { osm_type: 'R', osm_id: 41485, osm_key: 'place', osm_value: 'city', name: 'Roma', country: 'Italia' },
        },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: { osm_type: 'N', osm_id: 1, name: 'No coords' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'No id' } },
      ],
    }

    it('calls Photon with q, limit, lat/lon and a User-Agent; parses GeoJSON', async () => {
      const calls: { url: string; init: any }[] = []
      const res = await searchPlaces({}, { q: 'galata kulesi', near: { lat: 41, lon: 29 } }, async (url, init) => {
        calls.push({ url, init })
        return { ok: true, status: 200, json: async () => photonJson }
      })
      expect(calls[0].url).toBe('https://photon.komoot.io/api/?q=galata%20kulesi&limit=8&lat=41&lon=29')
      expect(calls[0].init.headers['User-Agent']).toBe(USER_AGENT)
      expect(res).toEqual([
        { provider: 'osm', providerId: 'W24618397', name: 'Galata Kulesi', address: 'Galata Kulesi Sokağı, İstanbul, Türkiye', lat: 41.0256, lon: 28.9741, category: 'historic' },
        { provider: 'osm', providerId: 'N123', name: "Sant'Eustachio", address: "Piazza di Sant'Eustachio 82, Roma, Italia", lat: 41.8986, lon: 12.4755, category: 'coffee' },
        { provider: 'osm', providerId: 'R41485', name: 'Roma', address: 'Italia', lat: 41.89, lon: 12.49, category: 'other' },
      ])
    })

    it('without lat/lon the URL has no location; bad payloads parse to []; failures are 502', async () => {
      let seen = ''
      await searchPlaces({}, { q: 'roma', near: null }, async (url) => { seen = url; return { ok: true, status: 200, json: async () => ({}) } })
      expect(seen).toBe('https://photon.komoot.io/api/?q=roma&limit=8')
      expect(parsePhoton({ features: 'x' })).toEqual([])
      const err = await searchPlaces({}, { q: 'roma', near: null }, async () => ({ ok: false, status: 500, json: async () => ({}) })).catch((e) => e)
      expect(err.status).toBe(502)
    })
  })
})
