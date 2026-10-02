export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const TOKEN_KEY = 'voyage.token';

export type Category =
  | 'food' | 'coffee' | 'bar' | 'historic' | 'museum' | 'park' | 'beach' | 'hotel' | 'airport' | 'other';
export type ListVisibility = 'private' | 'public';
export type CommentVisibility = 'private' | 'friends' | 'public';

export interface User { id: string | number; handle: string; email: string }
export interface AuthResult { token: string; user: User }
export interface ListSummary {
  id: string | number; city: string; title: string; visibility: ListVisibility;
  allowCopy: boolean; allowComments: boolean; itemCount: number; updatedAt: string;
}
export interface ListItem {
  placeId: string | number; name: string; lat: number | null; lon: number | null;
  category: Category; note: string | null; position: number;
}
export interface ListDetail {
  id: string | number; ownerId: string | number; ownerHandle: string; city: string; title: string;
  visibility: ListVisibility; allowCopy: boolean; allowComments: boolean; items: ListItem[];
}
export interface ItemInput {
  provider: string; providerId: string; name: string; lat?: number; lon?: number;
  category?: Category; city?: string; note?: string;
}
export interface DiscoverList {
  id: string | number; city: string; title: string; ownerHandle: string; itemCount: number; avgStars: number | null;
}
export interface PlaceDetail {
  place: { id: string | number; name: string; lat: number | null; lon: number | null; category: Category; city: string | null };
  rating: { count: number; avg: number | null; distribution: { stars: number; n: number }[]; mine: number | null };
}
export interface PlaceComment {
  id: string | number; parentId: string | number | null; body: string; visibility: CommentVisibility;
  createdAt: string; authorId: string | number; author: string;
}
export interface SocialUser { id: string | number; handle: string; following: boolean; followsMe: boolean }

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const getToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t: string): void => {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
};
export const clearToken = (): void => {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Sunucuya ulaşılamadı');
  }
  if (res.status === 401 && auth) {
    clearToken();
    if (!location.pathname.startsWith('/login')) location.assign('/login');
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
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
    request<{ id: string | number }>('POST', '/lists', { city, title, visibility }),
  patchList: (id: string | number, patch: Partial<{ title: string; visibility: ListVisibility; allowCopy: boolean; allowComments: boolean }>) =>
    request<{ ok: true }>('PATCH', `/lists/${id}`, patch),
  deleteList: (id: string | number) => request<{ ok: true }>('DELETE', `/lists/${id}`),
  putItems: (id: string | number, items: ItemInput[]) =>
    request<{ ok: true; count: number }>('PUT', `/lists/${id}/items`, { items }),
  getList: (id: string | number) => request<ListDetail>('GET', `/lists/${id}`),
  discover: (city: string) => request<DiscoverList[]>('GET', `/discover/lists?city=${q(city)}`),
  getPlace: (id: string | number) => request<PlaceDetail>('GET', `/places/${id}`),
  rate: (id: string | number, stars: number) => request<{ ok: true }>('PUT', `/places/${id}/rating`, { stars }),
  comments: (id: string | number) => request<PlaceComment[]>('GET', `/places/${id}/comments`),
  addComment: (id: string | number, body: string, visibility: CommentVisibility) =>
    request<{ id: string | number }>('POST', `/places/${id}/comments`, { body, visibility }),
  deleteComment: (id: string | number) => request<{ ok: true }>('DELETE', `/comments/${id}`),
  report: (targetType: 'comment' | 'list' | 'user', targetId: string | number, reason: string) =>
    request<{ ok: true }>('POST', '/reports', { targetType, targetId, reason }),
  block: (userId: string | number) => request<{ ok: true }>('POST', `/blocks/${userId}`),
  unblock: (userId: string | number) => request<{ ok: true }>('DELETE', `/blocks/${userId}`),
  searchUsers: (qs: string) => request<SocialUser[]>('GET', `/users/search?q=${q(qs)}`),
  following: () => request<SocialUser[]>('GET', '/following'),
  follow: (userId: string | number) => request<{ ok: true }>('POST', `/follows/${userId}`),
  unfollow: (userId: string | number) => request<{ ok: true }>('DELETE', `/follows/${userId}`),
};
