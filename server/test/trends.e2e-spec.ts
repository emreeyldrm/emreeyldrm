import { INestApplication } from '@nestjs/common'
import { api, Client, createApp, item, listWithItems, register, RUN } from './helpers'

/**
 * TRD: "Keşfet: haftanın trendleri ve kategoriler" (docs/ACCEPTANCE.md). Each test uses its own city (with RUN)
 * because the Worker database is shared across spec files. Old signals are created with the X-Test-Now header,
 * which both servers honour only when E2E_TEST_HOOKS=1 (Jest setup, start:e2e scripts).
 */
const DAY = 86_400_000
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString()

let n = 1000
/** A search-provider place in `city` (unique provider id per call). */
const place = (city: string, extra: object = {}) => {
  const i = ++n
  return item(i, { name: `Yer ${i}`, city, ...extra })
}

describe('Discover trends (TRD)', () => {
  let app: INestApplication
  let owner: Client
  const users: Client[] = []
  beforeAll(async () => {
    app = await createApp()
    owner = await register(app)
    for (let i = 0; i < 10; i++) users.push(await register(app))
  })
  afterAll(async () => { await app.close() })

  const home = async (c: Client, city: string, category?: string, now?: string) => {
    const url = `/discover/home?city=${encodeURIComponent(city)}${category ? `&category=${category}` : ''}`
    const req = c.get(url)
    if (now) req.set('X-Test-Now', now)
    return (await req.expect(200)).body
  }
  const view = (c: Client, id: number, now?: string) => {
    const req = c.get(`/places/${id}`)
    if (now) req.set('X-Test-Now', now)
    return req.expect(200)
  }
  const card = (list: any[], id: number) => list.find((x) => x.placeId === id)
  const ids = (list: any[]) => list.map((x) => x.placeId)

  it('requires a session and a city; rejects unknown categories', async () => {
    await api(app).get('/discover/home?city=Roma').expect(401)
    await owner.get('/discover/home').expect(400)
    await owner.get('/discover/home?city=%20').expect(400)
    await owner.get('/discover/home?city=Roma&category=nope').expect(400)
    const empty = await home(owner, `Bos-${RUN}`)
    expect(empty).toEqual({ city: `Bos-${RUN}`, placeOfWeek: null, trending: [], topRated: [], mostSearched: [], categoryCounts: {} })
  })

  it('AC-TRD-1: a view counts once per person per day, a save once per person; signals older than 7 days do not count', async () => {
    const city = `Trd1-${RUN}`
    const p = place(city)
    const { id: listId, placeIds: [pid] } = await listWithItems(owner, [p], { city, visibility: 'public' }) // save 1 (owner)
    const [u1, u2, u3] = users

    await view(u1, pid)
    await view(u1, pid) // same day: ignored
    await view(owner, pid)
    await view(u1, pid, at(-1)) // another day (yesterday)
    await view(u2, pid, at(-8)) // older than 7 days
    // re-saving the same list, the same place in a second list and re-adding it do not count again
    await owner.put(`/lists/${listId}/items`, { items: [p] }).expect(200)
    await listWithItems(owner, [p], { city })
    await listWithItems(u1, [p], { city }) // save 2 (u1)
    const u1List = (await u1.get('/lists/mine').expect(200)).body[0].id
    await u1.put(`/lists/${u1List}/items`, { items: [] }).expect(200)
    await u1.put(`/lists/${u1List}/items`, { items: [p] }).expect(200)
    const old = (await u3.post('/lists', { city, title: 'old' }).expect(201)).body.id
    await u3.put(`/lists/${old}/items`, { items: [p] }).set('X-Test-Now', at(-9)).expect(200) // old save

    const res = await home(u2, city)
    expect(card(res.mostSearched, pid)).toEqual({
      placeId: pid, name: p.name, category: 'food', city, lat: p.lat, lon: p.lon,
      avgStars: null, ratingCount: 0, views7d: 3, saves7d: 2, score: 5,
    })
    expect(card(res.trending, pid).score).toBe(3 + 3 * 2)

    // the window slides: eight days later nothing of this week counts any more
    const later = await home(u2, city, undefined, at(9))
    expect(later.trending).toEqual([])
    expect(later.mostSearched).toEqual([])
    // ...but the old events are back in the window when viewed from their own time
    const past = await home(u2, city, undefined, at(-8))
    expect(card(past.mostSearched, pid)).toMatchObject({ views7d: 1, saves7d: 1 })
  })

  it('AC-TRD-2: trending is ordered by views + 3×saves + 2×ratings + 2×comments; no signal, no entry; at most 10', async () => {
    const city = `Trd2-${RUN}`
    const [u1, u2, u3] = users
    const items = Array.from({ length: 12 }, () => place(city))
    const { placeIds } = await listWithItems(owner, items, { city, visibility: 'public' }) // every place: 1 save = 3
    const [a, b, c, d] = placeIds
    // a: 3 + 2 views + 1 rating + 1 public comment (+ private and friends comments that do not count) = 3+2+2+2 = 9
    await view(u1, a); await view(u2, a)
    await u1.put(`/places/${a}/rating`, { stars: 4 }).expect(200)
    await u2.post(`/places/${a}/comments`, { body: 'harika' }).expect(201)
    await u2.post(`/places/${a}/comments`, { body: 'gizli', visibility: 'private' }).expect(201)
    await u2.post(`/places/${a}/comments`, { body: 'arkadaş', visibility: 'friends' }).expect(201)
    // b: 3 + 1 save by u3 (3) + 1 view (1) = 7
    await listWithItems(u3, [items[1]], { city }); await view(u3, b)
    // c and d: 3 + 1 rating (2) = 5 each (same rating count: name order)
    await u1.put(`/places/${c}/rating`, { stars: 5 }).expect(200)
    await u1.put(`/places/${d}/rating`, { stars: 5 }).expect(200)
    // a signal-less place (its only save is 10 days old) never enters
    const quiet = place(city)
    const ql = (await u3.post('/lists', { city, title: 'eski' }).expect(201)).body.id
    await u3.put(`/lists/${ql}/items`, { items: [quiet] }).set('X-Test-Now', at(-10)).expect(200)
    const quietId = (await u3.get(`/lists/${ql}`).expect(200)).body.items[0].placeId

    const res = await home(u1, city)
    expect(res.trending).toHaveLength(10)
    expect(res.trending.slice(0, 2).map((x: any) => [x.placeId, x.score])).toEqual([[a, 9], [b, 7]])
    expect(card(res.trending, a)).toMatchObject({ views7d: 2, saves7d: 1, ratingCount: 1, avgStars: 4 })
    expect(card(res.trending, b)).toMatchObject({ views7d: 1, saves7d: 2 })
    const scores = res.trending.map((x: any) => x.score)
    expect([...scores].sort((x: number, y: number) => y - x)).toEqual(scores)
    expect(ids(res.trending).slice(2, 4)).toEqual([c, d])
    expect(ids(res.trending)).not.toContain(quietId)
    expect(ids(res.mostSearched)).not.toContain(quietId)
    // equal score and equal rating count: name order ("Yer N" names are increasing with N)
    const rest = res.trending.slice(4)
    expect(rest.every((x: any) => x.score === 3)).toBe(true)
    expect(rest.map((x: any) => x.name)).toEqual([...rest.map((x: any) => x.name)].sort())

    // equal score: more ratings first, even against the name order
    const city2 = `Trd2b-${RUN}`
    const pr = place(city2, { name: 'Zz puanlı' })
    const pv = place(city2, { name: 'Aa bakılan' })
    const { placeIds: [rId, vId] } = await listWithItems(owner, [pr, pv], { city: city2, visibility: 'public' })
    await view(u1, rId); await u2.put(`/places/${rId}/rating`, { stars: 3 }).expect(200) // 3 + 1 + 2 = 6
    await view(u1, vId); await view(u2, vId); await view(u3, vId) // 3 + 3 = 6
    const tie = await home(u1, city2)
    expect(tie.trending.map((x: any) => [x.placeId, x.score])).toEqual([[rId, 6], [vId, 6]]) // more ratings first
  })

  it('AC-TRD-3: topRated uses the Bayesian average (one 5 does not beat ten averaging 4.6); category filter', async () => {
    const city = `Trd3-${RUN}`
    const one = place(city, { name: 'Tek beşlik' })
    const ten = place(city, { name: 'On puanlı' })
    const bar = place(city, { name: 'Bar', category: 'bar' })
    const unrated = place(city, { name: 'Puansız' })
    const { placeIds: [oneId, tenId, barId, unratedId] } = await listWithItems(owner, [one, ten, bar, unrated], { city, visibility: 'public' })
    await users[0].put(`/places/${oneId}/rating`, { stars: 5 }).expect(200)
    for (let i = 0; i < 10; i++) await users[i].put(`/places/${tenId}/rating`, { stars: i < 6 ? 5 : 4 }).expect(200)
    await users[0].put(`/places/${barId}/rating`, { stars: 3 }).expect(200)

    const res = await home(owner, city)
    expect(ids(res.topRated)).toEqual([tenId, oneId, barId])
    expect(card(res.topRated, tenId)).toMatchObject({ avgStars: 4.6, ratingCount: 10, score: 4.35 }) // (46+10.5)/13
    expect(card(res.topRated, oneId)).toMatchObject({ avgStars: 5, ratingCount: 1, score: 3.88 }) // (5+10.5)/4
    expect(ids(res.topRated)).not.toContain(unratedId)
    expect(ids((await home(owner, city, 'bar')).topRated)).toEqual([barId])
    expect(ids((await home(owner, city, 'food')).topRated)).toEqual([tenId, oneId])
    expect((await home(owner, city, 'beach')).topRated).toEqual([])
    // the category only filters topRated
    expect((await home(owner, city, 'bar')).trending).toHaveLength(4)
    expect(res.categoryCounts).toEqual({ food: 3, bar: 1 })
  })

  it('AC-TRD-4: placeOfWeek is the trending food place with weighted average ≥ 3.5; null without one', async () => {
    const city = `Trd4-${RUN}`
    const [u1, u2, u3] = users
    const loud = place(city, { name: 'Kötü ama popüler' })
    const good = place(city, { name: 'Haftanın lokantası' })
    const bar = place(city, { name: 'Süper bar', category: 'bar' })
    const { placeIds: [loudId, goodId, barId] } = await listWithItems(owner, [loud, good, bar], { city, visibility: 'public' })
    for (const u of [u1, u2, u3]) await view(u, loudId)
    for (const u of [u1, u2]) await u.put(`/places/${loudId}/rating`, { stars: 2 }).expect(200) // avg 2 -> weighted 3.1
    await u1.put(`/places/${goodId}/rating`, { stars: 4 }).expect(200) // weighted 3.625
    for (const u of [u1, u2, u3]) { await view(u, barId); await u.put(`/places/${barId}/rating`, { stars: 5 }).expect(200) }

    const res = await home(u1, city)
    expect(ids(res.trending)).toEqual([barId, loudId, goodId])
    expect(res.placeOfWeek).toEqual({
      placeId: goodId, name: good.name, category: 'food', city, lat: good.lat, lon: good.lon,
      avgStars: 4, ratingCount: 1, views7d: 0, saves7d: 1, score: 3 + 2,
    })

    const city2 = `Trd4b-${RUN}`
    const meh = place(city2)
    const { placeIds: [mehId] } = await listWithItems(owner, [meh], { city: city2, visibility: 'public' })
    await u1.put(`/places/${mehId}/rating`, { stars: 3 }).expect(200) // weighted 3.375 < 3.5
    const none = await home(u1, city2)
    expect(ids(none.trending)).toEqual([mehId])
    expect(none.placeOfWeek).toBeNull()
  })

  it('AC-TRD-5: mostSearched is ordered by views + saves (ratings and comments do not count)', async () => {
    const city = `Trd5-${RUN}`
    const [u1, u2, u3] = users
    const rated = place(city, { name: 'Çok puanlı' })
    const seen = place(city, { name: 'Çok bakılan' })
    const { placeIds: [ratedId, seenId] } = await listWithItems(owner, [rated, seen], { city, visibility: 'public' })
    for (const u of [u1, u2, u3]) await u.put(`/places/${ratedId}/rating`, { stars: 5 }).expect(200)
    await u1.post(`/places/${ratedId}/comments`, { body: 'iyi' }).expect(201)
    for (const u of [u1, u2]) await view(u, seenId)

    const res = await home(u1, city)
    expect(res.mostSearched.map((x: any) => [x.placeId, x.score])).toEqual([[seenId, 3], [ratedId, 1]])
    expect(res.trending.map((x: any) => [x.placeId, x.score])).toEqual([[ratedId, 3 + 6 + 2], [seenId, 3 + 2]])
  })

  it('AC-TRD-6: the city filter is case and diacritic insensitive; other cities never show up', async () => {
    const city = `İzmir${RUN}`
    const p = place(city)
    const other = place(`Ankara${RUN}`)
    const similar = place(`İzmir${RUN}x`)
    const { placeIds } = await listWithItems(owner, [p, other, similar], { city, visibility: 'public' })
    for (const q of [`izmir${RUN}`, `IZMIR${RUN.toUpperCase()}`, `ızmır${RUN}`, `  İZMİR${RUN.toUpperCase()} `]) {
      const res = await home(users[0], q)
      expect(res.city).toBe(q.trim())
      expect(ids(res.trending)).toEqual([placeIds[0]])
      expect(ids(res.mostSearched)).toEqual([placeIds[0]])
      expect(res.categoryCounts).toEqual({ food: 1 })
    }
    expect(ids((await home(users[0], `ankara${RUN}`)).trending)).toEqual([placeIds[1]])
  })

  it('AC-TRD-7: a manual place only in private lists never shows; it shows once it is in a public list', async () => {
    const city = `Trd7-${RUN}`
    const [u1, u2] = users
    const manual = place(city, { provider: 'voyage', providerId: `manual-${RUN}`, name: 'Gizli köşe' })
    const listed = await listWithItems(u1, [manual], { city }) // private
    const pid = listed.placeIds[0]
    await view(u2, pid)
    await u2.put(`/places/${pid}/rating`, { stars: 5 }).expect(200)
    await u2.post(`/places/${pid}/comments`, { body: 'süper' }).expect(201)
    let res = await home(u2, city)
    expect(res).toEqual({ city, placeOfWeek: null, trending: [], topRated: [], mostSearched: [], categoryCounts: {} })
    expect((await home(u2, city, 'food')).topRated).toEqual([])

    // a search-provider place in a private list is fine
    const fromSearch = place(city, { provider: 'osm', name: 'Haritadaki yer' })
    const { placeIds: [osmId] } = await listWithItems(u1, [fromSearch], { city })
    expect(ids((await home(u2, city)).trending)).toEqual([osmId])

    await u1.patch(`/lists/${listed.id}`, { visibility: 'public' }).expect(200)
    res = await home(u2, city)
    expect(ids(res.trending)).toContain(pid)
    expect(ids(res.topRated)).toEqual([pid])
    expect(res.placeOfWeek?.placeId).toBe(pid)
    // never says who viewed or saved: only counts
    expect(Object.keys(card(res.trending, pid)).sort()).toEqual(
      ['avgStars', 'category', 'city', 'lat', 'lon', 'name', 'placeId', 'ratingCount', 'saves7d', 'score', 'views7d'])
  })

  it('AC-TRD-8: deleting an account deletes its signals (counts drop)', async () => {
    const city = `Trd8-${RUN}`
    const p = place(city)
    const { placeIds: [pid] } = await listWithItems(owner, [p], { city, visibility: 'public' })
    const gone = await register(app)
    await view(gone, pid)
    await listWithItems(gone, [p], { city })
    await gone.put(`/places/${pid}/rating`, { stars: 5 }).expect(200)
    await gone.post(`/places/${pid}/comments`, { body: 'görüşürüz' }).expect(201)
    let c = card((await home(owner, city)).trending, pid)
    expect(c).toMatchObject({ views7d: 1, saves7d: 2, ratingCount: 1, score: 1 + 6 + 2 + 2 })

    await gone.del('/me').expect(200)
    c = card((await home(owner, city)).trending, pid)
    expect(c).toMatchObject({ views7d: 0, saves7d: 1, ratingCount: 0, avgStars: null, score: 3 })
  })
})
