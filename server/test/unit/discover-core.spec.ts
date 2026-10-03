import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  avgStarsOf, bayesianAverage, buildHome, eventDay, foldCity, isDiscoverable, isPlaceOfWeekCandidate, matchingCities,
  rankBy, resolveNow, sameCity, searchScore, toSignals, trendScore, windowStart, type PlaceSignals,
} from '../../src/discover/discover-core'
import { fold } from '../../src/search/search-core'
import { requestNow } from '../../src/common/util'

const root = join(__dirname, '..', '..', '..')

let nextId = 1
const sig = (o: Partial<PlaceSignals> = {}): PlaceSignals => ({
  placeId: nextId++, name: `P${nextId}`, category: 'food', city: 'İstanbul', lat: null, lon: null, provider: 'osm',
  inPublicList: false, views7d: 0, saves7d: 0, ratings7d: 0, comments7d: 0, ratingCount: 0, ratingSum: 0, ...o,
})

describe('discover-core', () => {
  it('is byte-identical in server/ (NestJS) and backend/ (Worker)', () => {
    const nest = readFileSync(join(root, 'server', 'src', 'discover', 'discover-core.ts'), 'utf8')
    const worker = readFileSync(join(root, 'backend', 'src', 'discover-core.ts'), 'utf8')
    expect(worker).toBe(nest)
  })

  it('foldCity matches search-core fold (İ/I/ı/i equal, accents ignored)', () => {
    for (const s of ['İstanbul', 'ISTANBUL', 'ıstanbul', 'Köln', 'São Paulo', 'Çeşme', 'Muğla', 'IĞDIR']) {
      expect(foldCity(s)).toBe(fold(s).trim())
    }
    expect(foldCity(' İSTANBUL ')).toBe('istanbul')
    expect(sameCity('istanbul', 'İstanbul')).toBe(true)
    expect(sameCity('Istanbul', 'ıstanbul')).toBe(true)
    expect(sameCity('Cesme', 'Çeşme')).toBe(true)
    expect(sameCity('Ankara', 'İstanbul')).toBe(false)
    expect(sameCity(null, 'x')).toBe(false)
    expect(sameCity(' ', ' ')).toBe(false)
    expect(matchingCities('istanbul', ['İstanbul', 'Istanbul', null, 'Ankara', 'ISTANBUL'])).toEqual(['İstanbul', 'Istanbul', 'ISTANBUL'])
  })

  it('Bayesian average (Σ + 3×3.5)/(n + 3)', () => {
    expect(bayesianAverage(0, 0)).toBe(3.5)
    expect(bayesianAverage(5, 1)).toBeCloseTo(15.5 / 4) // 3.875
    expect(bayesianAverage(46, 10)).toBeCloseTo(56.5 / 13) // ≈ 4.346
    // one 5-star rating does not beat ten ratings averaging 4.6
    expect(bayesianAverage(5, 1)).toBeLessThan(bayesianAverage(46, 10))
    expect(avgStarsOf({ ratingSum: 46, ratingCount: 10 })).toBe(4.6)
    expect(avgStarsOf({ ratingSum: 14, ratingCount: 3 })).toBe(4.7)
    expect(avgStarsOf({ ratingSum: 0, ratingCount: 0 })).toBeNull()
  })

  it('trend score = views + 3×saves + 2×ratings + 2×comments; search score = views + saves', () => {
    expect(trendScore({ views7d: 4, saves7d: 2, ratings7d: 3, comments7d: 1 })).toBe(4 + 6 + 6 + 2)
    expect(trendScore({ views7d: 0, saves7d: 0, ratings7d: 0, comments7d: 0 })).toBe(0)
    expect(searchScore({ views7d: 4, saves7d: 2 })).toBe(6)
  })

  it('tie-breaks: higher score, then more ratings, then name (accent-insensitive), then id', () => {
    const a = sig({ name: 'Beta', views7d: 5, ratingCount: 1 })
    const b = sig({ name: 'alfa', views7d: 5, ratingCount: 1 })
    const c = sig({ name: 'Zeta', views7d: 5, ratingCount: 4 })
    const d = sig({ name: 'Çay', views7d: 9 })
    const e = sig({ name: 'Çay', views7d: 9 })
    expect(rankBy([a, b, c, e, d], trendScore).map((x) => x.placeId)).toEqual([d.placeId, e.placeId, c.placeId, b.placeId, a.placeId])
  })

  it('privacy predicate: manual (voyage) places only when in a public list', () => {
    expect(isDiscoverable('osm', false)).toBe(true)
    expect(isDiscoverable('google', false)).toBe(true)
    expect(isDiscoverable('voyage', false)).toBe(false)
    expect(isDiscoverable('voyage', true)).toBe(true)
  })

  it('placeOfWeek rule: food, trend score > 0, ≥ 1 rating, weighted average ≥ 3.5', () => {
    expect(isPlaceOfWeekCandidate(sig({ views7d: 1, ratingCount: 1, ratingSum: 4 }))).toBe(true)
    expect(isPlaceOfWeekCandidate(sig({ views7d: 1, ratingCount: 2, ratingSum: 7 }))).toBe(true) // exactly 3.5
    expect(isPlaceOfWeekCandidate(sig({ views7d: 1, ratingCount: 2, ratingSum: 6 }))).toBe(false) // < 3.5
    expect(isPlaceOfWeekCandidate(sig({ views7d: 1 }))).toBe(false) // no rating
    expect(isPlaceOfWeekCandidate(sig({ ratingCount: 1, ratingSum: 5 }))).toBe(false) // no signal this week
    expect(isPlaceOfWeekCandidate(sig({ category: 'bar', views7d: 9, ratingCount: 1, ratingSum: 5 }))).toBe(false)
  })

  it('buildHome: sections, limits, category filter, counts and privacy', () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => sig({ name: `V${String(i).padStart(2, '0')}`, category: 'museum', views7d: i + 1 })),
      sig({ name: 'Hidden', provider: 'voyage', views7d: 100, ratingCount: 5, ratingSum: 25 }),
      sig({ name: 'Public manual', provider: 'voyage', inPublicList: true, saves7d: 1 }),
      sig({ name: 'Elsewhere', city: 'Ankara', views7d: 100 }),
      sig({ name: 'Old rating', category: 'bar', ratingCount: 1, ratingSum: 5 }),
      sig({ name: 'Bad food', views7d: 50, ratingCount: 3, ratingSum: 3 }),
      sig({ name: 'Good food', views7d: 2, ratings7d: 1, ratingCount: 1, ratingSum: 5 }),
    ]
    const home = buildHome('istanbul', rows)
    expect(home.city).toBe('istanbul')
    const names = (cards: { name: string }[]) => cards.map((c) => c.name)
    expect(home.trending).toHaveLength(10)
    expect(names(home.trending).slice(0, 3)).toEqual(['Bad food', 'V11', 'V10'])
    expect(names(home.trending)).not.toContain('Hidden')
    expect(names(home.trending)).not.toContain('Elsewhere')
    expect(names(home.trending)).not.toContain('Old rating') // no signal this week
    expect(home.placeOfWeek?.name).toBe('Good food')
    expect(home.placeOfWeek?.score).toBe(4)
    expect(names(home.topRated)).toEqual(['Good food', 'Old rating', 'Bad food'])
    expect(home.topRated[0]).toMatchObject({ avgStars: 5, ratingCount: 1, score: 3.88 })
    expect(names(buildHome('İSTANBUL', rows, 'bar').topRated)).toEqual(['Old rating'])
    expect(home.mostSearched[0]).toMatchObject({ name: 'Bad food', score: 50, views7d: 50, saves7d: 0 })
    expect(names(home.mostSearched)).toHaveLength(10)
    expect(home.categoryCounts).toEqual({ museum: 12, food: 3, bar: 1 })
    expect(buildHome('Yok', rows)).toEqual({ city: 'Yok', placeOfWeek: null, trending: [], topRated: [], mostSearched: [], categoryCounts: {} })
  })

  it('toSignals coerces SQL rows', () => {
    const s = toSignals({ placeId: 3, name: 'X', category: 'bar', city: null, lat: 1.5, lon: null, provider: 'osm', inPublicList: 1, views7d: '2', saves7d: null })
    expect(s).toMatchObject({ placeId: 3, inPublicList: true, views7d: 2, saves7d: 0, lat: 1.5, lon: null, city: null, ratingCount: 0 })
  })

  it('window start and event day', () => {
    const now = new Date('2026-10-10T08:00:00.000Z')
    expect(windowStart(now)).toBe('2026-10-03T08:00:00.000Z')
    expect(eventDay(now)).toBe('2026-10-10')
  })

  it('test hook: X-Test-Now is honoured only when E2E_TEST_HOOKS=1', () => {
    const real = new Date('2026-01-01T00:00:00.000Z')
    const fake = '2020-05-05T05:05:05.000Z'
    expect(resolveNow(fake, '1', real).toISOString()).toBe(fake)
    expect(resolveNow(fake, undefined, real)).toBe(real)
    expect(resolveNow(fake, '', real)).toBe(real)
    expect(resolveNow(fake, '0', real)).toBe(real)
    expect(resolveNow(fake, 'true', real)).toBe(real)
    expect(resolveNow('garbage', '1', real)).toBe(real)
    expect(resolveNow(undefined, '1', real)).toBe(real)
  })

  it('NestJS requestNow ignores the header without the env var', () => {
    const saved = process.env.E2E_TEST_HOOKS
    try {
      delete process.env.E2E_TEST_HOOKS
      expect(requestNow('2020-05-05T00:00:00.000Z').getFullYear()).toBeGreaterThan(2020)
      process.env.E2E_TEST_HOOKS = '1'
      expect(requestNow('2020-05-05T00:00:00.000Z').toISOString()).toBe('2020-05-05T00:00:00.000Z')
    } finally {
      if (saved === undefined) delete process.env.E2E_TEST_HOOKS
      else process.env.E2E_TEST_HOOKS = saved
    }
  })

  it('Worker wiring: the hook env var is set only by the e2e start script, never in wrangler.toml', () => {
    const toml = readFileSync(join(root, 'backend', 'wrangler.toml'), 'utf8')
    expect(toml).not.toMatch(/E2E_TEST_HOOKS/)
    expect(readFileSync(join(root, 'backend', 'scripts', 'start-e2e.mjs'), 'utf8')).toMatch(/E2E_TEST_HOOKS:1/)
    const index = readFileSync(join(root, 'backend', 'src', 'index.ts'), 'utf8')
    expect(index).toMatch(/resolveNow\(c\.req\.header\(TEST_NOW_HEADER\), c\.env\.E2E_TEST_HOOKS\)/)
  })
})
