import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'

/**
 * When API_URL is set (e.g. `API_URL=http://localhost:8790`), the suite runs against that external server
 * (the Cloudflare Worker in backend/, see `npm run test:contract` there) instead of an in-process Nest app.
 * All files then share one database, so tests must use unique handles, emails, cities and place ids (see RUN).
 */
export const API_URL = process.env.API_URL || undefined

/** Random tag, unique per test file run; used to keep names unique when files share one database. */
export const RUN = Math.random().toString(36).slice(2, 7)

/** Handle/email-safe unique name: `base` must be at most 14 characters to stay within 20. */
export const uniq = (base: string) => `${base}_${RUN}`

export async function createApp(): Promise<INestApplication> {
  if (API_URL) {
    // External mode: nothing to start or stop.
    return { getHttpServer: () => API_URL, close: async () => {} } as unknown as INestApplication
  }
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = mod.createNestApplication()
  app.enableCors()
  await app.init()
  return app
}

/** A supertest agent for the app under test (in-process server or API_URL). */
export const api = (app: INestApplication) => request(API_URL ?? app.getHttpServer())

export interface Client {
  id: number
  handle: string
  email: string
  token: string
  get: (url: string) => request.Test
  post: (url: string, body?: object) => request.Test
  put: (url: string, body?: object) => request.Test
  patch: (url: string, body?: object) => request.Test
  del: (url: string) => request.Test
}

let seq = 0

/** Registers a fresh user and returns an authenticated client. */
export async function register(app: INestApplication, name?: string): Promise<Client> {
  const handle = name ?? `user_${++seq}_${RUN}`
  const email = `${handle}@example.com`
  const res = await api(app).post('/auth/register').send({ email, password: 'password123', handle })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`)
  return client(app, res.body.token, res.body.user)
}

export function client(app: INestApplication, token: string, user: { id: number; handle: string; email: string }): Client {
  const s = () => api(app)
  const auth = (t: request.Test) => t.set('Authorization', `Bearer ${token}`)
  return {
    ...user,
    token,
    get: (u) => auth(s().get(u)),
    post: (u, b) => auth(s().post(u)).send(b ?? {}),
    put: (u, b) => auth(s().put(u)).send(b ?? {}),
    patch: (u, b) => auth(s().patch(u)).send(b ?? {}),
    del: (u) => auth(s().delete(u)),
  }
}

export const item = (n: number, extra: object = {}) => ({
  provider: 'apple', providerId: `pid-${RUN}-${n}`, name: `Place ${n}`, lat: 41 + n / 100, lon: 29 + n / 100, category: 'food', ...extra,
})

/** Creates a list owned by `c` with the given items; returns list id and the place ids in order. */
export async function listWithItems(c: Client, items: object[], opts: { city?: string; visibility?: string; title?: string } = {}) {
  const created = await c.post('/lists', { city: opts.city ?? 'Istanbul', title: opts.title ?? 'My list', visibility: opts.visibility })
  const id = created.body.id as number
  await c.put(`/lists/${id}/items`, { items }).expect(200)
  const detail = await c.get(`/lists/${id}`).expect(200)
  return { id, placeIds: detail.body.items.map((i: any) => i.placeId) as number[] }
}

export async function mutualFollow(a: Client, b: Client) {
  await a.post(`/follows/${b.id}`).expect(200)
  await b.post(`/follows/${a.id}`).expect(200)
}
