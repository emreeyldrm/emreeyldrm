import { deleteToken, readToken, writeToken } from './tokenStore';

/** Contract API (docs/ACCEPTANCE.md). Production: Cloudflare Worker in backend/. */
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/+$/, '');

export type Id = string | number;
export type Category =
  | 'food' | 'coffee' | 'bar' | 'historic' | 'museum' | 'park' | 'beach' | 'hotel' | 'airport' | 'other';
export type ListVisibility = 'private' | 'public';
export type CommentVisibility = 'private' | 'friends' | 'public';

export interface User { id: Id; handle: string; email: string }
export interface AuthResult { token: string; user: User }
export interface ListSummary {
  id: Id; city: string; title: string; visibility: ListVisibility;
  allowCopy: boolean; allowComments: boolean; itemCount: number; updatedAt: string;
}
export interface ListItem {
  /** Place identity from the client/search provider; kept when the list is re-saved (PUT replaces all items). */
  placeId: Id; provider?: string; providerId?: string; name: string; lat: number | null; lon: number | null;
  category: Category; note: string | null; position: number;
}
export interface ListDetail {
  id: Id; ownerId: Id; ownerHandle: string; city: string; title: string;
  visibility: ListVisibility; allowCopy: boolean; allowComments: boolean; items: ListItem[];
}
export interface ItemInput {
  provider: string; providerId: string; name: string; lat?: number; lon?: number;
  category?: Category; city?: string; note?: string;
}
export interface DiscoverList {
  id: Id; city: string; title: string; ownerHandle: string; itemCount: number; avgStars: number | null;
}
export interface PlaceDetail {
  place: { id: Id; name: string; lat: number | null; lon: number | null; category: Category; city: string | null };
  rating: { count: number; avg: number | null; distribution: { stars: number; n: number }[]; mine: number | null };
}
export interface PlaceComment {
  id: Id; parentId: Id | null; body: string; visibility: CommentVisibility;
  createdAt: string; authorId: Id; author: string;
}
/** GET /search/places result (AC-SRCH-1); provider is `google`, `osm` (Photon) or `fake` (tests). */
export interface SearchResult {
  provider: string; providerId: string; name: string; address: string; lat: number; lon: number; category: Category;
}
export interface SocialUser { id: Id; handle: string; following: boolean; followsMe: boolean }

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export async function loadToken(): Promise<string | null> {
  token = await readToken();
  return token;
}
export async function setToken(t: string): Promise<void> {
  token = t;
  await writeToken(t);
}
export async function clearToken(): Promise<void> {
  token = null;
  await deleteToken();
}
export const hasToken = (): boolean => token !== null;
/** Called when an authenticated request answers 401 (expired/deleted account). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Sunucuya ulaşılamadı');
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (res.status === 401 && auth) {
    await clearToken();
    onUnauthorized?.();
  }
  if (!res.ok) {
    const msg = (data as { error?: string | string[] } | null)?.error;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join(', ') : msg ?? `Hata (${res.status})`);
  }
  return data as T;
}

const q = encodeURIComponent;

export const api = {
  register: (email: string, password: string, handle: string) =>
    request<AuthResult>('POST', '/auth/register', { email, password, handle }, false),
  login: (email: string, password: string) => request<AuthResult>('POST', '/auth/login', { email, password }, false),
  me: () => request<User>('GET', '/me'),
  deleteMe: () => request<{ ok: true }>('DELETE', '/me'),
  myLists: () => request<ListSummary[]>('GET', '/lists/mine'),
  createList: (city: string, title: string, visibility?: ListVisibility) =>
    request<{ id: Id }>('POST', '/lists', visibility ? { city, title, visibility } : { city, title }),
  patchList: (id: Id, patch: Partial<{ title: string; visibility: ListVisibility; allowCopy: boolean; allowComments: boolean }>) =>
    request<{ ok: true }>('PATCH', `/lists/${id}`, patch),
  deleteList: (id: Id) => request<{ ok: true }>('DELETE', `/lists/${id}`),
  putItems: (id: Id, items: ItemInput[]) => request<{ ok: true; count: number }>('PUT', `/lists/${id}/items`, { items }),
  getList: (id: Id) => request<ListDetail>('GET', `/lists/${id}`),
  discover: (city: string) => request<DiscoverList[]>('GET', `/discover/lists?city=${q(city)}`),
  getPlace: (id: Id) => request<PlaceDetail>('GET', `/places/${id}`),
  rate: (id: Id, stars: number) => request<{ ok: true }>('PUT', `/places/${id}/rating`, { stars }),
  comments: (id: Id) => request<PlaceComment[]>('GET', `/places/${id}/comments`),
  addComment: (id: Id, body: string, visibility: CommentVisibility) =>
    request<{ id: Id }>('POST', `/places/${id}/comments`, { body, visibility }),
  deleteComment: (id: Id) => request<{ ok: true }>('DELETE', `/comments/${id}`),
  report: (targetType: 'comment' | 'list' | 'user', targetId: Id, reason: string) =>
    request<{ ok: true }>('POST', '/reports', { targetType, targetId, reason }),
  block: (userId: Id) => request<{ ok: true }>('POST', `/blocks/${userId}`),
  unblock: (userId: Id) => request<{ ok: true }>('DELETE', `/blocks/${userId}`),
  searchUsers: (qs: string) => request<SocialUser[]>('GET', `/users/search?q=${q(qs)}`),
  following: () => request<SocialUser[]>('GET', '/following'),
  searchPlaces: (qs: string, near?: { lat: number; lon: number } | null) =>
    request<SearchResult[]>('GET', `/search/places?q=${q(qs)}${near ? `&lat=${near.lat.toFixed(5)}&lon=${near.lon.toFixed(5)}` : ''}`),
  follow: (userId: Id) => request<{ ok: true }>('POST', `/follows/${userId}`),
  unfollow: (userId: Id) => request<{ ok: true }>('DELETE', `/follows/${userId}`),
};

/** Stable client-side place key: same name + approx. coordinates (~100 m) => same `places` row. */
export function providerIdFor(name: string, city: string, lat: number | null, lon: number | null): string {
  const slug = name.trim().toLowerCase();
  if (lat !== null && lon !== null) return `${slug}@${lat.toFixed(3)},${lon.toFixed(3)}`;
  return `${slug}@${city.trim().toLowerCase()}`;
}

/**
 * Builds the PUT /lists/:id/items entry. A known identity (saved item or search result: `provider`/`providerId`)
 * is kept as is; manual places get a stable `voyage` id derived from name + coordinates.
 */
export function toItemInput(
  city: string,
  it: {
    name: string; lat: number | null; lon: number | null; category: Category; note: string | null;
    provider?: string | null; providerId?: string | null;
  },
): ItemInput {
  const known = !!it.provider && !!it.providerId;
  const out: ItemInput = {
    provider: known ? (it.provider as string) : 'voyage',
    providerId: known ? (it.providerId as string) : providerIdFor(it.name, city, it.lat, it.lon),
    name: it.name,
    category: it.category,
    city,
  };
  if (it.note) out.note = it.note;
  if (it.lat !== null && it.lon !== null) {
    out.lat = it.lat;
    out.lon = it.lon;
  }
  return out;
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
