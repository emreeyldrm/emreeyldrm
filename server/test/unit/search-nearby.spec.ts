import {
  distanceM, fakeNearby, GOOGLE_FIELD_MASK, isOsmPoi, parseGoogleNearby, parseNearbyQuery, parsePhotonNearby,
  parseResolveInput, photonReverseUrl, searchNearby, SearchError, USER_AGENT, type FetchLike,
} from '../../src/search/search-core'

// TAP: GET /search/nearby (dokunulan noktanın çevresindeki adlandırılmış yerler) ve POST /places/resolve girdisi.
const C = { lat: 41.8902, lon: 12.4922 }
const ok = (json: unknown): ReturnType<FetchLike> => Promise.resolve({ ok: true, status: 200, json: async () => json })

describe('search-core: nearby (TAP)', () => {
  it('parseNearbyQuery: lat/lon are required and valid; lang is optional', () => {
    expect(parseNearbyQuery('41.89', '12.49')).toEqual({ near: { lat: 41.89, lon: 12.49 } })
    expect(parseNearbyQuery('41.89', '12.49', 'EN-us')).toEqual({ near: { lat: 41.89, lon: 12.49 }, lang: 'en' })
    expect(parseNearbyQuery('0', '0', '__')).toEqual({ near: { lat: 0, lon: 0 } })
    for (const [lat, lon] of [[undefined, undefined], ['41', undefined], ['', '12'], ['x', '12'], ['91', '0'], ['0', '-181'], [41 as unknown, 12 as unknown]]) {
      expect(() => parseNearbyQuery(lat, lon)).toThrow(SearchError)
    }
  })

  it('isOsmPoi keeps businesses and sights, drops streets, buildings, places, boundaries and street furniture', () => {
    const keep: [string, string][] = [
      ['amenity', 'restaurant'], ['amenity', 'cafe'], ['amenity', 'pharmacy'], ['tourism', 'hotel'], ['tourism', 'attraction'],
      ['leisure', 'park'], ['historic', 'monument'], ['shop', 'bakery'], ['natural', 'beach'], ['aeroway', 'aerodrome'],
      ['craft', 'brewery'], ['office', 'company'],
    ]
    const drop: [string, string][] = [
      ['highway', 'residential'], ['building', 'yes'], ['place', 'house'], ['place', 'city'], ['boundary', 'administrative'],
      ['natural', 'tree'], ['amenity', 'parking'], ['amenity', 'bench'], ['tourism', 'information'], ['landuse', 'retail'],
      ['railway', 'rail'], ['aeroway', 'gate'],
    ]
    for (const [k, v] of keep) expect([k, v, isOsmPoi(k, v)]).toEqual([k, v, true])
    for (const [k, v] of drop) expect([k, v, isOsmPoi(k, v)]).toEqual([k, v, false])
    expect(isOsmPoi(undefined, 'cafe')).toBe(false)
  })

  describe('Photon reverse (mocked fetch)', () => {
    const f = (props: Record<string, unknown>, lat: number, lon: number) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { osm_type: 'N', ...props },
    })
    const json = {
      type: 'FeatureCollection',
      features: [
        f({ osm_id: 1, osm_key: 'highway', osm_value: 'pedestrian', name: 'Piazza del Colosseo', city: 'Roma' }, C.lat, C.lon),
        f({ osm_id: 2, osm_key: 'building', osm_value: 'yes', street: 'Via Labicana', housenumber: '12' }, C.lat + 0.0001, C.lon),
        f({ osm_id: 3, osm_key: 'place', osm_value: 'house', street: 'Via Labicana', housenumber: '14', city: 'Roma' }, C.lat, C.lon + 0.0001),
        f({ osm_id: 4, osm_key: 'amenity', osm_value: 'cafe', name: 'Bar Far', city: 'Roma' }, C.lat + 0.0018, C.lon), // ~200 m
        f({ osm_id: 5, osm_key: 'amenity', osm_value: 'restaurant', name: 'Trattoria Mid', street: 'Via Capo d\'Africa', housenumber: '5', city: 'Roma', country: 'Italia' }, C.lat + 0.0006, C.lon), // ~67 m
        f({ osm_id: 6, osm_key: 'historic', osm_value: 'monument', name: 'Colosseo', city: 'Roma' }, C.lat + 0.0001, C.lon + 0.0001), // ~14 m
        f({ osm_id: 7, osm_key: 'amenity', osm_value: 'cafe', street: 'Via Unnamed' }, C.lat, C.lon), // no own name
        f({ osm_id: 8, osm_key: 'boundary', osm_value: 'administrative', name: 'Municipio I' }, C.lat, C.lon),
        f({ osm_id: 9, osm_key: 'amenity', osm_value: 'parking', name: 'Parcheggio' }, C.lat, C.lon),
        f({ osm_id: 10, osm_key: 'tourism', osm_value: 'hotel', name: 'Hotel Near' }, C.lat - 0.001, C.lon), // ~111 m
      ],
    }

    it('calls /reverse with lat, lon, limit, radius (km), supported lang and a User-Agent', async () => {
      const calls: { url: string; init: any }[] = []
      await searchNearby({}, { near: C, lang: 'en' }, async (url, init) => { calls.push({ url, init }); return ok({}) })
      await searchNearby({}, { near: C, lang: 'tr' }, async (url, init) => { calls.push({ url, init }); return ok({}) })
      expect(calls.map((c) => c.url)).toEqual([
        'https://photon.komoot.io/reverse?lat=41.8902&lon=12.4922&limit=20&radius=0.15&lang=en',
        'https://photon.komoot.io/reverse?lat=41.8902&lon=12.4922&limit=20&radius=0.15',
      ])
      expect(calls[0].init.method).toBe('GET')
      expect(calls[0].init.headers['User-Agent']).toBe(USER_AGENT)
      expect(calls[0].init.signal).toBeDefined()
      expect(photonReverseUrl({ near: { lat: 1, lon: 2 } })).toBe('https://photon.komoot.io/reverse?lat=1&lon=2&limit=20&radius=0.15')
    })

    it('keeps only named POIs within 150 m, nearest first, in the /search/places shape', async () => {
      const res = await searchNearby({ SEARCH_PROVIDER: 'photon' }, { near: C }, () => ok(json))
      expect(res).toEqual([
        { provider: 'osm', providerId: 'N6', name: 'Colosseo', address: 'Roma', lat: C.lat + 0.0001, lon: C.lon + 0.0001, category: 'historic' },
        { provider: 'osm', providerId: 'N5', name: 'Trattoria Mid', address: "Via Capo d'Africa 5, Roma, Italia", lat: C.lat + 0.0006, lon: C.lon, category: 'food' },
        { provider: 'osm', providerId: 'N10', name: 'Hotel Near', address: '', lat: C.lat - 0.001, lon: C.lon, category: 'hotel' },
      ])
    })

    it('returns at most 8; odd payloads parse to []; failures are 502', async () => {
      const many = { features: Array.from({ length: 15 }, (_, i) => f({ osm_id: 100 + i, osm_key: 'shop', osm_value: 'gift', name: `Shop ${i}` }, C.lat + i * 0.00005, C.lon)) }
      const res = parsePhotonNearby(many, C)
      expect(res.map((r) => r.name)).toEqual(['Shop 0', 'Shop 1', 'Shop 2', 'Shop 3', 'Shop 4', 'Shop 5', 'Shop 6', 'Shop 7'])
      expect(parsePhotonNearby(null, C)).toEqual([])
      expect(parsePhotonNearby({ features: 'x' }, C)).toEqual([])
      const err = await searchNearby({}, { near: C }, async () => ({ ok: false, status: 500, json: async () => ({}) })).catch((e) => e)
      expect(err).toBeInstanceOf(SearchError)
      expect(err.status).toBe(502)
    })
  })

  describe('Google Nearby Search (mocked fetch)', () => {
    const place = (id: string, name: string, lat: number, lon: number, primaryType: string, types: string[] = [primaryType]) => ({
      id, displayName: { text: name }, formattedAddress: `${name} sokak, Roma`, location: { latitude: lat, longitude: lon }, primaryType, types,
    })
    const json = {
      places: [
        place('g-far', 'Far Cafe', C.lat + 0.0016, C.lon, 'cafe'), // ~178 m: outside
        place('g-mid', 'Pizzeria', C.lat + 0.0005, C.lon, 'pizza_restaurant', ['pizza_restaurant', 'restaurant']),
        place('g-near', 'Colosseo', C.lat, C.lon + 0.0001, 'historical_landmark'),
        place('g-addr', 'Via Labicana 12', C.lat, C.lon, 'street_address'),
        place('g-route', 'Via Labicana', C.lat, C.lon, 'route'),
        { id: 'g-broken', displayName: { text: 'Broken' } },
      ],
    }

    it('sends searchNearby with a 150 m circle restriction, DISTANCE ranking, 10 results, language and field mask', async () => {
      const calls: { url: string; init: any }[] = []
      await searchNearby({ GOOGLE_PLACES_API_KEY: 'secret-key' }, { near: C, lang: 'it' }, async (url, init) => { calls.push({ url, init }); return ok({}) })
      await searchNearby({ GOOGLE_PLACES_API_KEY: 'secret-key' }, { near: C }, async (url, init) => { calls.push({ url, init }); return ok({}) })
      expect(calls[0].url).toBe('https://places.googleapis.com/v1/places:searchNearby')
      expect(calls[0].init.method).toBe('POST')
      expect(calls[0].init.headers).toMatchObject({ 'X-Goog-Api-Key': 'secret-key', 'X-Goog-FieldMask': GOOGLE_FIELD_MASK })
      expect(JSON.parse(calls[0].init.body)).toEqual({
        locationRestriction: { circle: { center: { latitude: C.lat, longitude: C.lon }, radius: 150 } },
        rankPreference: 'DISTANCE', maxResultCount: 10, languageCode: 'it',
      })
      expect(JSON.parse(calls[1].init.body).languageCode).toBe('tr')
    })

    it('parses places, drops address/route results and far ones, sorts by distance', async () => {
      const res = await searchNearby({ GOOGLE_PLACES_API_KEY: 'k' }, { near: C }, () => ok(json))
      expect(res).toEqual([
        { provider: 'google', providerId: 'g-near', name: 'Colosseo', address: 'Colosseo sokak, Roma', lat: C.lat, lon: C.lon + 0.0001, category: 'historic' },
        { provider: 'google', providerId: 'g-mid', name: 'Pizzeria', address: 'Pizzeria sokak, Roma', lat: C.lat + 0.0005, lon: C.lon, category: 'food' },
      ])
      expect(parseGoogleNearby({ places: 'nope' }, C)).toEqual([])
    })

    it('errors become 502 without leaking the key; a forced google provider without a key is 502', async () => {
      const err = await searchNearby({ GOOGLE_PLACES_API_KEY: 'secret-key' }, { near: C },
        async () => ({ ok: false, status: 403, json: async () => ({}) })).catch((e) => e)
      expect(err.status).toBe(502)
      expect(err.message).not.toContain('secret-key')
      const forced = await searchNearby({ SEARCH_PROVIDER: 'google' }, { near: C }, async () => { throw new Error('unused') }).catch((e) => e)
      expect(forced.status).toBe(502)
    })
  })

  it('fake provider: fixtures within 300 m, nearest first; never calls fetch', async () => {
    const madrid = { lat: 40.4150, lon: -3.7077 }
    expect(fakeNearby({ near: madrid }).map((r) => r.providerId)).toEqual(['fake-la-campana', 'fake-campana-cafe'])
    expect(fakeNearby({ near: { lat: 40.4159, lon: -3.7080 } }).map((r) => r.providerId)).toEqual(['fake-campana-cafe', 'fake-la-campana'])
    expect(fakeNearby({ near: { lat: C.lat, lon: C.lon + 0.01 } })).toEqual([])
    for (const r of fakeNearby({ near: madrid })) expect(distanceM(madrid, r)).toBeLessThanOrEqual(300)
    const res = await searchNearby({ SEARCH_PROVIDER: 'fake' }, { near: C }, async () => { throw new Error('no network') })
    expect(res.map((r) => r.name)).toEqual(['Colosseo'])
  })
})

describe('search-core: parseResolveInput (TAP)', () => {
  const base = { provider: 'osm', providerId: 'N1', name: ' Trattoria ', lat: 41.9, lon: 12.5, category: 'food' }
  it('normalises valid input; unknown category -> other; empty city -> null', () => {
    expect(parseResolveInput({ ...base, city: ' Roma ' })).toEqual({
      provider: 'osm', providerId: 'N1', name: 'Trattoria', lat: 41.9, lon: 12.5, category: 'food', city: 'Roma',
    })
    expect(parseResolveInput({ ...base, category: 'spaceship', city: '' })).toMatchObject({ category: 'other', city: null })
  })
  it('rejects voyage, missing and invalid fields with 400', () => {
    const bad = [
      null, {}, { ...base, provider: 'voyage' }, { ...base, provider: '' }, { ...base, providerId: 3 }, { ...base, name: ' ' },
      { ...base, lat: undefined }, { ...base, lat: '41' }, { ...base, lon: 181 }, { ...base, lat: NaN }, { ...base, category: undefined },
      { ...base, city: 7 },
    ]
    for (const b of bad) {
      const err = (() => { try { parseResolveInput(b); return null } catch (e) { return e } })() as SearchError | null
      expect(err).toBeInstanceOf(SearchError)
      expect(err!.status).toBe(400)
    }
  })
})
