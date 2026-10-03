import { deleteToken, readToken, writeToken } from './tokenStore';
import { deviceLanguage } from './locale';
import type { PlaceDetails } from './details';
import { getQueue, getUser, isDeviceOnline, markReachable, offlineReady, readCache, removeCache, writeCache } from './offlineStore';
import { isTemp, overlayComments, overlayList, overlayMine, overlayPlace, rewritePath } from './syncCore';

export type { PlaceDetails } from './details';

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
  /** Çevrimdışı: bu listede eşitlenmeyi bekleyen değişiklik var (AC-OFF-2). */
  pending?: boolean;
  /** COL: sahip olunan (`owner`) ya da üyesi olunan (`editor`) liste; eski önbellekte olmayabilir (= owner). */
  role?: ListRole;
  ownerHandle?: string;
}
export interface ListItem {
  /** Place identity from the client/search provider; kept when the list is re-saved (PUT replaces all items). */
  placeId: Id; provider?: string; providerId?: string; name: string; lat: number | null; lon: number | null;
  category: Category; note: string | null; position: number;
  /** DET: servis, bekleme, öneri, harcama, favoriler, fotoğraflar; yoksa `{}`. */
  details?: PlaceDetails;
  /** Çevrimdışı eklendi/düzenlendi, eşitlenmeyi bekliyor (AC-OFF-2). */
  pending?: boolean;
}
export interface ListDetail {
  id: Id; ownerId: Id; ownerHandle: string; city: string; title: string;
  visibility: ListVisibility; allowCopy: boolean; allowComments: boolean; items: ListItem[];
  pending?: boolean;
  /** COL: isteği yapanın rolü (`null`: üye değil); memberCount sahip hariç üye sayısı. Eski önbellekte olmayabilir. */
  myRole?: ListRole | null;
  memberCount?: number;
}
export type ListRole = 'owner' | 'editor';
export interface ItemInput {
  provider: string; providerId: string; name: string; lat?: number; lon?: number;
  category?: Category; city?: string; note?: string; details?: PlaceDetails;
}
export interface DiscoverList {
  id: Id; city: string; title: string; ownerHandle: string; itemCount: number; avgStars: number | null;
}
/** GET /discover/home kartı (TRD). `score` bölüme göre: trend puanı, ağırlıklı ortalama ya da bakış + kayıt. */
export interface PlaceCard {
  placeId: Id; name: string; category: Category; city: string | null; lat: number | null; lon: number | null;
  avgStars: number | null; ratingCount: number; views7d: number; saves7d: number; score: number;
}
export interface DiscoverHome {
  city: string;
  placeOfWeek: PlaceCard | null;
  trending: PlaceCard[];
  topRated: PlaceCard[];
  mostSearched: PlaceCard[];
  categoryCounts: Partial<Record<Category, number>>;
}
export interface PlaceDetail {
  place: { id: Id; name: string; lat: number | null; lon: number | null; category: Category; city: string | null };
  rating: {
    count: number; avg: number | null; distribution: { stars: number; n: number }[]; mine: number | null;
    /** Çevrimdışı verilen puan, eşitlenmeyi bekliyor (AC-OFF-2). */
    pending?: boolean;
  };
}
export interface PlaceComment {
  id: Id; parentId: Id | null; body: string; visibility: CommentVisibility;
  createdAt: string; authorId: Id; author: string;
  /** Medya kimlikleri (AC-DET-7); yoksa `[]`. */
  photos?: string[];
  /** Çevrimdışı yazıldı, eşitlenmeyi bekliyor (AC-OFF-2). */
  pending?: boolean;
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
/** Current session token (media uploads use their own XHR to report progress). */
export const currentToken = (): string | null => token;
/** Called when an authenticated request answers 401 (expired/deleted account). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/** Çevrimdışıyken sunucu gerektiren işlemlerin mesajı (AC-OFF-4). */
export const OFFLINE_MSG = 'Çevrimdışısın. Bu işlem için internet bağlantısı gerekli.';
export const OFFLINE_NOT_CACHED_MSG = 'Çevrimdışısın ve bu sayfa daha önce açılmadığı için gösterilemiyor.';
/** Ağ hatası ya da çevrimdışı (sunucuya ulaşılamadı). */
export const isNetworkError = (e: unknown): boolean => e instanceof ApiError && e.status === 0;

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  // Cihaz çevrimdışıysa istek hiç denenmez (zaman aşımı beklemeden önbelleğe / kuyruğa düşülür).
  if (!isDeviceOnline()) throw new ApiError(0, OFFLINE_MSG);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    markReachable(false);
    throw new ApiError(0, 'Sunucuya ulaşılamadı');
  }
  markReachable(true);
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

/**
 * Önbellekli GET (AC-OFF-1): başarılı yanıt cihazda saklanır; ağ yoksa ya da sunucuya ulaşılamazsa son saklanan
 * hâli döner. `overlay` bekleyen (eşitlenmemiş) değişiklikleri veriye bindirir (AC-OFF-2). Çevrimdışı oluşturulan
 * listenin geçici kimliği (`tmp-…`) eşlendiyse gerçek kimlikle istenir; eşlenmediyse yalnızca kuyruktan kurulur.
 */
async function cachedGet<T>(path: string, overlay?: (data: T | null) => T | null): Promise<T> {
  await offlineReady();
  const real = rewritePath(path, getQueue().idMap);
  let data: T | null = null;
  if (/\/tmp-/.test(real)) {
    data = null;
  } else {
    try {
      data = await request<T>('GET', real);
      void writeCache(real, data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) void removeCache(real);
      if (!isNetworkError(e)) throw e;
      const hit = await readCache<T>(real);
      if (!hit) {
        const built = overlay?.(null);
        if (built) return built;
        throw new ApiError(0, OFFLINE_NOT_CACHED_MSG);
      }
      data = hit.data;
    }
  }
  if (!overlay) return data as T;
  const out = overlay(data);
  if (out === null) throw new ApiError(404, 'Bulunamadı');
  return out;
}

/** Sunucudaki hâli (bekleyen değişiklikler bindirilmeden) alır ve önbelleğe yazar; eşitleme sonrası tazeleme için. */
export async function refreshCache(path: string): Promise<void> {
  const data = await request<unknown>('GET', path);
  await writeCache(path, data);
}

const q = encodeURIComponent;
const pid = (id: Id) => String(id);

export const api = {
  register: (email: string, password: string, handle: string) =>
    request<AuthResult>('POST', '/auth/register', { email, password, handle }, false),
  login: (email: string, password: string) => request<AuthResult>('POST', '/auth/login', { email, password }, false),
  me: () => cachedGet<User>('/me'),
  deleteMe: () => request<{ ok: true }>('DELETE', '/me'),
  myLists: () => cachedGet<ListSummary[]>('/lists/mine', (d) => (d || getQueue().ops.some((o) => o.type === 'createList') ? overlayMine(d ?? [], getQueue()) : null)),
  createList: (city: string, title: string, visibility?: ListVisibility) =>
    request<{ id: Id }>('POST', '/lists', visibility ? { city, title, visibility } : { city, title }),
  patchList: (id: Id, patch: Partial<{ title: string; visibility: ListVisibility; allowCopy: boolean; allowComments: boolean }>) =>
    request<{ ok: true }>('PATCH', `/lists/${id}`, patch),
  deleteList: (id: Id) => request<{ ok: true }>('DELETE', `/lists/${id}`),
  putItems: (id: Id, items: ItemInput[]) => request<{ ok: true; count: number }>('PUT', `/lists/${id}/items`, { items }),
  /** Bekleyen değişiklikler bindirilmemiş, önbelleğe bakmayan liste (kuyruk işlerken sunucudaki güncel hâl). */
  fetchList: (id: Id) => request<ListDetail>('GET', `/lists/${id}`),
  /** Sunucuya ulaşılabiliyor mu (çevrimdışı şeridini kaldırmak için yoklama). */
  ping: () => request<User>('GET', '/me'),
  getList: (id: Id) => cachedGet<ListDetail>(`/lists/${id}`, (d) => overlayList(d, pid(id), getQueue(), getUser())),
  discover: (city: string) => cachedGet<DiscoverList[]>(`/discover/lists?city=${q(city)}`),
  discoverHome: (city: string, category?: Category | null) =>
    cachedGet<DiscoverHome>(`/discover/home?city=${q(city)}${category ? `&category=${category}` : ''}`),
  getPlace: (id: Id) => cachedGet<PlaceDetail>(`/places/${id}`, (d) => (d ? overlayPlace(d, pid(id), getQueue()) : null)),
  rate: (id: Id, stars: number) => request<{ ok: true }>('PUT', `/places/${id}/rating`, { stars }),
  comments: (id: Id) => cachedGet<PlaceComment[]>(`/places/${id}/comments`, (d) => (d ? overlayComments(d, pid(id), getQueue(), getUser()) : null)),
  addComment: (id: Id, body: string, visibility: CommentVisibility, photos: string[] = []) =>
    request<{ id: Id }>('POST', `/places/${id}/comments`, photos.length ? { body, visibility, photos } : { body, visibility }),
  deleteComment: (id: Id) => request<{ ok: true }>('DELETE', `/comments/${id}`),
  report: (targetType: 'comment' | 'list' | 'user', targetId: Id, reason: string) =>
    request<{ ok: true }>('POST', '/reports', { targetType, targetId, reason }),
  block: (userId: Id) => request<{ ok: true }>('POST', `/blocks/${userId}`),
  unblock: (userId: Id) => request<{ ok: true }>('DELETE', `/blocks/${userId}`),
  searchUsers: (qs: string) => request<SocialUser[]>('GET', `/users/search?q=${q(qs)}`),
  following: () => request<SocialUser[]>('GET', '/following'),
  searchPlaces: (qs: string, near?: { lat: number; lon: number } | null) =>
    request<SearchResult[]>('GET', `/search/places?q=${q(qs)}${near ? `&lat=${near.lat.toFixed(5)}&lon=${near.lon.toFixed(5)}` : ''}&lang=${deviceLanguage()}`),
  /** TAP: haritada dokunulan noktanın çevresindeki adlandırılmış yerler (en yakından uzağa, en çok 8). */
  searchNearby: (near: { lat: number; lon: number }) =>
    request<SearchResult[]>('GET', `/search/nearby?lat=${near.lat.toFixed(6)}&lon=${near.lon.toFixed(6)}&lang=${deviceLanguage()}`),
  /** TAP: sağlayıcı yerinin `placeId`'si (yoksa oluşturulur); listeye eklemeden puan ve yorum için. */
  resolvePlace: (r: SearchResult, city?: string | null) =>
    request<{ placeId: Id }>('POST', '/places/resolve', {
      provider: r.provider, providerId: r.providerId, name: r.name, lat: r.lat, lon: r.lon, category: r.category,
      ...(city ? { city } : {}),
    }),
  follow: (userId: Id) => request<{ ok: true }>('POST', `/follows/${userId}`),
  unfollow: (userId: Id) => request<{ ok: true }>('DELETE', `/follows/${userId}`),
};

// ---------------------------------------------------------------------------------------------------------------
// Liste kopyalama ve ortak listeler (CPY / COL, AC-MOB-37..39). Hepsi çevrimiçi işlemlerdir (sıraya alınmaz);
// yalnızca üye listesi okunurken son görülen hâli önbellekten gösterilebilir.
export interface ListMember { id: Id; handle: string; role: 'editor'; addedAt: string }

export const collabApi = {
  copyList: (id: Id) => request<{ id: Id }>('POST', `/lists/${id}/copy`),
  members: (id: Id) => cachedGet<ListMember[]>(`/lists/${id}/members`),
  addMember: (id: Id, handle: string) => request<ListMember>('POST', `/lists/${id}/members`, { handle }),
  removeMember: async (id: Id, userId: Id) => {
    const r = await request<{ ok: true }>('DELETE', `/lists/${id}/members/${userId}`);
    // Ayrılan/çıkarılan üye için eski önbellek kalmasın (erişimi bitti).
    void removeCache(`/lists/${id}/members`);
    return r;
  },
  /** Listeden ayrılınca bu listenin önbelleği silinir (özel listeye artık erişilemez, AC-COL-4). */
  forgetList: async (id: Id) => {
    await Promise.all([removeCache(`/lists/${id}`), removeCache(`/lists/${id}/members`)]);
  },
};
// ---------------------------------------------------------------------------------------------------------------

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
    provider?: string | null; providerId?: string | null; details?: PlaceDetails | null;
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
  // Detaylar (fotoğraflar dahil) yeniden kaydederken aynen geri gönderilir: PUT listeyi komple değiştirir.
  if (it.details && Object.keys(it.details).length) out.details = it.details;
  if (it.lat !== null && it.lon !== null) {
    out.lat = it.lat;
    out.lon = it.lon;
  }
  return out;
}

/** Çevrimdışı oluşturulmuş, henüz sunucuya gitmemiş kimlik mi (liste, yer, yorum)? */
export const isPendingId = (id: Id | null | undefined): boolean => isTemp(id);

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// MSG (src/lib/chat.ts): mesajlaşma uçları aynı istek ve önbellek katmanını kullanır.
export { request as apiRequest, cachedGet as apiCachedGet };
