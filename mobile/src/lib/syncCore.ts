/**
 * Çevrimdışı çalışma (AC-OFF-1..5): saf (React Native'den bağımsız) kuyruk ve görünüm mantığı.
 * Birim testleri: `unit/offline.spec.ts`.
 *
 * Kuyruk ham PUT gövdeleri değil **niyet** saklar ("şu yeri ekle", "şunu çıkar"). Bağlantı gelince liste işleri
 * sunucudaki güncel listeyi alır, niyeti onun üzerine yeniden uygular ve PUT eder; böylece başka cihazdan yapılan
 * değişiklikler kaybolmaz. Ekranlar sunucu (ya da önbellek) verisinin üstüne bekleyen işleri bindirerek gösterir
 * (`overlay*`), bekleyen öğeler `pending: true` taşır ("Eşitlenmeyi bekliyor").
 */
import type {
  Category, CommentVisibility, Id, ItemInput, ListDetail, ListItem, ListSummary, PlaceComment, PlaceDetail,
} from './api';
import type { PlaceDetails } from './details';

/** Çevrimdışı oluşturulan listelerin ve yorumların geçici kimlik öneki. */
export const TEMP_PREFIX = 'tmp-';
/** Çevrimdışı seçilen (henüz yüklenmemiş) fotoğrafın medya kimliği yerine geçen başvuru. */
export const LOCAL_PREFIX = 'local:';

export const isTemp = (id: Id | null | undefined): boolean => typeof id === 'string' && id.startsWith(TEMP_PREFIX);
export const isLocalPhoto = (id: string): boolean => id.startsWith(LOCAL_PREFIX);

export interface ItemKey { provider: string; providerId: string }
export interface ItemPatch { category?: Category; note?: string | null; details?: PlaceDetails }

interface OpBase { id: string; at: number }
export type OpInput =
  | { type: 'createList'; tempId: string; city: string; title: string }
  | { type: 'addItem'; listId: string; item: ItemInput; listLabel?: string }
  | { type: 'updateItem'; listId: string; key: ItemKey; name: string; patch: ItemPatch; listLabel?: string }
  | { type: 'removeItem'; listId: string; key: ItemKey; name: string; listLabel?: string }
  | { type: 'rate'; placeId: string; stars: number; placeName?: string }
  | { type: 'comment'; placeId: string; tempId: string; body: string; visibility: CommentVisibility; photos: string[]; placeName?: string };
export type Op = OpBase & OpInput;
export type ListOp = Extract<Op, { type: 'addItem' | 'updateItem' | 'removeItem' }>;

export interface LocalPhoto { uri: string; type: string }
/** Gönderilemeyen (kalıcı hata alan) değişiklik: kullanıcıya gösterilir. */
export interface Failure { id: string; label: string; reason: string; at: number }

export interface QueueState {
  ops: Op[];
  /** Geçici kimlik → sunucu kimliği (liste `tmp-…`, fotoğraf `local:…`, yorum `tmp-…`). */
  idMap: Record<string, string>;
  /** `local:<ref>` → cihazdaki dosya (yüklenene kadar). */
  photos: Record<string, LocalPhoto>;
  failures: Failure[];
}
export const emptyQueue = (): QueueState => ({ ops: [], idMap: {}, photos: {}, failures: [] });

export interface OverlayUser { id: Id; handle: string }

export const isListOp = (op: Op): op is ListOp => op.type === 'addItem' || op.type === 'updateItem' || op.type === 'removeItem';

/** Geçici kimliği (eşlenmişse) sunucu kimliğine çevirir. */
export function resolveId(id: string, idMap: Record<string, string>): string {
  return idMap[id] ?? id;
}

/** `/lists/tmp-1` gibi yollardaki eşlenmiş geçici kimlikleri gerçek kimlikle değiştirir. */
export function rewritePath(path: string, idMap: Record<string, string>): string {
  return path.replace(/tmp-[A-Za-z0-9_-]+/g, (m) => idMap[m] ?? m);
}

export const sameKey = (a: { provider?: string; providerId?: string }, b: ItemKey): boolean =>
  a.provider === b.provider && a.providerId === b.providerId;

/** Bir liste niyetini sunucudaki güncel öğelere uygular. Uygulanamıyorsa `{ error }`. */
export function applyListOp(items: ItemInput[], op: OpInput): ItemInput[] | { error: string } {
  if (op.type === 'addItem') {
    const idx = items.findIndex((i) => sameKey(i, op.item));
    // Aynı yer listede zaten varsa (ör. başka cihazdan eklendi) ikinci kez eklenmez, bilgileri güncellenir.
    if (idx >= 0) return items.map((it, k) => (k === idx ? { ...it, ...op.item } : it));
    return [...items, op.item];
  }
  if (op.type === 'updateItem') {
    const idx = items.findIndex((i) => sameKey(i, op.key));
    if (idx < 0) return { error: 'Yer artık listede değil.' };
    return items.map((it, k) => (k === idx ? withPatch(it, op.patch) : it));
  }
  if (op.type === 'removeItem') return items.filter((i) => !sameKey(i, op.key));
  return items;
}

function withPatch(it: ItemInput, patch: ItemPatch): ItemInput {
  const out: ItemInput = { ...it };
  if (patch.category !== undefined) out.category = patch.category;
  if (patch.note !== undefined) {
    if (patch.note) out.note = patch.note; else delete out.note;
  }
  if (patch.details !== undefined) {
    if (Object.keys(patch.details).length) out.details = patch.details; else delete out.details;
  }
  return out;
}

/** Kullanıcıya gösterilen kısa tanım: `Yer ekleme: "Kahve" (Roma)`. */
export function opLabel(op: OpInput): string {
  const where = (l?: string) => (l ? ` (${l})` : '');
  switch (op.type) {
    case 'createList': return `Liste oluşturma: "${op.title}" (${op.city})`;
    case 'addItem': return `Yer ekleme: "${op.item.name}"${where(op.listLabel)}`;
    case 'updateItem': return `Yer düzenleme: "${op.name}"${where(op.listLabel)}`;
    case 'removeItem': return `Yer çıkarma: "${op.name}"${where(op.listLabel)}`;
    case 'rate': return `Puan: ${op.stars} yıldız${op.placeName ? ` ("${op.placeName}")` : ''}`;
    case 'comment': {
      const text = op.body.length > 40 ? `${op.body.slice(0, 40)}…` : op.body;
      return `Yorum: ${text ? `"${text}"` : 'fotoğraflı yorum'}${op.placeName ? ` ("${op.placeName}")` : ''}`;
    }
  }
}

export type ErrorKind = 'transient' | 'permanent' | 'auth';
/** Ağ hatası (0), zaman aşımı, 429 ve 5xx geçicidir (yeniden denenir); 401 oturum biter; diğer 4xx kalıcıdır. */
export function classifyStatus(status: number): ErrorKind {
  if (status === 401) return 'auth';
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'transient';
  return 'permanent';
}
export const errorStatus = (e: unknown): number => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : 0;
};
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Yeniden deneme bekleme süresi: 2 s, 4 s, 8 s … en çok 60 s. */
export function backoffMs(attempt: number): number {
  return Math.min(60_000, 2000 * 2 ** Math.max(0, attempt));
}

/** Bir işin içindeki fotoğraf kimlikleri (yerel başvurular dahil). */
export function opPhotos(op: OpInput): string[] {
  if (op.type === 'addItem') return op.item.details?.photos ?? [];
  if (op.type === 'updateItem') return op.patch.details?.photos ?? [];
  if (op.type === 'comment') return op.photos;
  return [];
}

function withPhotos<T extends OpInput>(op: T, photos: string[]): T {
  if (op.type === 'addItem') return { ...op, item: { ...op.item, details: { ...op.item.details, photos } } };
  if (op.type === 'updateItem') return { ...op, patch: { ...op.patch, details: { ...op.patch.details, photos } } };
  if (op.type === 'comment') return { ...op, photos };
  return op;
}

export interface SyncDeps {
  createList(city: string, title: string): Promise<{ id: Id }>;
  /** Sunucudaki güncel liste, PUT girdisi biçiminde (sağlayıcı kimliği ve detaylar korunmuş). */
  getListItems(listId: string): Promise<ItemInput[]>;
  putItems(listId: string, items: ItemInput[]): Promise<unknown>;
  rate(placeId: string, stars: number): Promise<unknown>;
  addComment(placeId: string, body: string, visibility: CommentVisibility, photos: string[]): Promise<{ id: Id }>;
  uploadPhoto(photo: LocalPhoto): Promise<string>;
  /** Kuyruk durumu her değişiklikte kalıcı yazılır (uygulama kapanırsa kaldığı yerden devam eder). */
  persist(state: QueueState): Promise<void>;
  /** İş sunucuya ulaştı, kuyruktan çıkmadan önce: önbelleği tazelemek için (boşluk/titreme olmasın). */
  afterOp?(op: Op): Promise<void>;
  now?(): number;
}

export type FlushResult =
  | { status: 'done'; sent: number; failed: number }
  | { status: 'retry'; sent: number; failed: number; error: unknown }
  | { status: 'auth'; sent: number; failed: number };

class Transient extends Error {
  constructor(readonly cause: unknown) { super('transient'); }
}
class Permanent extends Error {
  constructor(readonly reason: string) { super(reason); }
}

/**
 * Kuyruğu sırayla işler. Kalıcı hata işi düşürür, `failures`'a yazar ve devam eder; geçici hata durur
 * (çağıran bekleyip yeniden dener); 401'de durur. `state` yerinde güncellenir (işlerken eklenen işler de işlenir).
 */
export async function processQueue(state: QueueState, deps: SyncDeps): Promise<FlushResult> {
  const now = deps.now ?? Date.now;
  let sent = 0;
  let failed = 0;
  const fail = async (op: Op, reason: string, label = opLabel(op)) => {
    state.failures = [...state.failures, { id: `${op.id}-${state.failures.length}`, label, reason, at: now() }];
    failed++;
  };
  const drop = async (op: Op) => {
    state.ops = state.ops.filter((o) => o.id !== op.id);
    await deps.persist(state);
  };

  while (state.ops.length) {
    const op = state.ops[0];
    try {
      const ready = await resolvePhotos(state, op, deps, fail);
      await execute(state, ready, deps);
      sent++;
      try { await deps.afterOp?.(op); } catch { /* önbellek tazelenemedi: bir sonraki açılışta */ }
      await drop(op);
    } catch (e) {
      if (e instanceof Permanent) {
        await fail(op, e.reason);
        await drop(op);
        continue;
      }
      // Sınıflandırılmamış (beklenmeyen) hata işi sonsuza dek tıkamasın: kalıcı sayılır.
      const kind = e instanceof Transient ? classifyStatus(errorStatus(e.cause)) : 'permanent';
      if (kind === 'auth') return { status: 'auth', sent, failed };
      if (kind === 'transient') return { status: 'retry', sent, failed, error: (e as Transient).cause };
      await fail(op, errorText(e));
      await drop(op);
    }
  }
  return { status: 'done', sent, failed };
}

/** Yerel fotoğrafları yükler ve işteki başvuruları medya kimlikleriyle değiştirir. */
async function resolvePhotos(state: QueueState, op: Op, deps: SyncDeps, fail: (op: Op, reason: string, label?: string) => Promise<void>): Promise<Op> {
  const photos = opPhotos(op);
  if (!photos.some(isLocalPhoto)) return op;
  const out: string[] = [];
  for (const p of photos) {
    if (!isLocalPhoto(p)) { out.push(p); continue; }
    const mapped = state.idMap[p];
    if (mapped) { out.push(mapped); continue; }
    const local = state.photos[p];
    if (!local) continue; // dosya kayboldu: fotoğrafsız devam
    try {
      const id = await deps.uploadPhoto(local);
      state.idMap = { ...state.idMap, [p]: id };
      const { [p]: _gone, ...rest } = state.photos;
      state.photos = rest;
      await deps.persist(state);
      out.push(id);
    } catch (e) {
      const kind = classifyStatus(errorStatus(e));
      if (kind !== 'permanent') throw new Transient(e);
      // Bu fotoğraf yüklenemez (tür/boyut): fotoğrafsız devam edilir, kullanıcıya bildirilir.
      await fail(op, `Fotoğraf yüklenemedi: ${errorText(e)}`, `Fotoğraf · ${opLabel(op)}`);
      const { [p]: _gone, ...rest } = state.photos;
      state.photos = rest;
    }
  }
  return withPhotos(op, out);
}

async function execute(state: QueueState, op: Op, deps: SyncDeps): Promise<void> {
  const wrap = async <T>(p: Promise<T>): Promise<T> => {
    try { return await p; } catch (e) {
      throw classifyStatus(errorStatus(e)) === 'permanent' ? new Permanent(friendly(errorStatus(e), errorText(e), op)) : new Transient(e);
    }
  };
  switch (op.type) {
    case 'createList': {
      const { id } = await wrap(deps.createList(op.city, op.title));
      state.idMap = { ...state.idMap, [op.tempId]: String(id) };
      await deps.persist(state);
      return;
    }
    case 'addItem':
    case 'updateItem':
    case 'removeItem': {
      const listId = resolveId(op.listId, state.idMap);
      if (isTemp(listId)) throw new Permanent('Liste oluşturulamadığı için gönderilemedi.');
      const current = await wrap(deps.getListItems(listId));
      const next = applyListOp(current, op);
      if ('error' in next) throw new Permanent(next.error);
      if (op.type === 'removeItem' && next.length === current.length) return; // zaten yok
      await wrap(deps.putItems(listId, next));
      return;
    }
    case 'rate':
      await wrap(deps.rate(op.placeId, op.stars));
      return;
    case 'comment': {
      const { id } = await wrap(deps.addComment(op.placeId, op.body, op.visibility, op.photos));
      state.idMap = { ...state.idMap, [op.tempId]: String(id) };
      return;
    }
  }
}

function friendly(status: number, msg: string, op: Op): string {
  if (status === 404) {
    if (isListOp(op)) return 'Liste bulunamadı (silinmiş ya da erişimin kalkmış olabilir).';
    if (op.type === 'rate' || op.type === 'comment') return 'Yer bulunamadı.';
  }
  if (status === 403) return `İzin yok: ${msg}`;
  return msg;
}

// ---------------------------------------------------------------------------------------------------------------
// Görünüm: sunucu/önbellek verisi + bekleyen işler.

const opsFor = <T extends Op['type']>(st: QueueState, type: T) => st.ops.filter((o): o is Extract<Op, { type: T }> => o.type === type);

function toListItem(item: ItemInput, opId: string, position: number): ListItem {
  return {
    placeId: `${TEMP_PREFIX}${opId}`,
    provider: item.provider,
    providerId: item.providerId,
    name: item.name,
    lat: item.lat ?? null,
    lon: item.lon ?? null,
    category: item.category ?? 'other',
    note: item.note ?? null,
    position,
    details: item.details ?? {},
    pending: true,
  };
}

/** `GET /lists/:id` görünümü. Sunucuda henüz olmayan (çevrimdışı oluşturulan) liste kuyruktan kurulur. */
export function overlayList(base: ListDetail | null, listId: string, st: QueueState, user: OverlayUser | null): ListDetail | null {
  const target = resolveId(String(listId), st.idMap);
  const matches = (id: string) => id === String(listId) || resolveId(id, st.idMap) === target;
  let out = base;
  if (!out) {
    const created = opsFor(st, 'createList').find((o) => matches(o.tempId));
    if (!created) return null;
    out = {
      id: created.tempId, ownerId: user?.id ?? '', ownerHandle: user?.handle ?? '', city: created.city, title: created.title,
      visibility: 'private', allowCopy: false, allowComments: true, items: [], pending: true,
    };
  }
  const ops = st.ops.filter((o): o is ListOp => isListOp(o) && matches(o.listId));
  if (!ops.length) return out;
  let items: ListItem[] = [...out.items].sort((a, b) => a.position - b.position);
  for (const op of ops) {
    if (op.type === 'addItem') {
      const idx = items.findIndex((i) => sameKey(i, op.item));
      if (idx >= 0) {
        const it = items[idx];
        items = items.map((x, k) => (k === idx ? {
          ...it, name: op.item.name, category: op.item.category ?? it.category, note: op.item.note ?? null,
          details: op.item.details ?? {}, pending: true,
        } : x));
      } else {
        const pos = items.reduce((m, i) => Math.max(m, i.position), -1) + 1;
        items = [...items, toListItem(op.item, op.id, pos)];
      }
    } else if (op.type === 'updateItem') {
      items = items.map((it) => {
        if (!sameKey(it, op.key)) return it;
        const next: ListItem = { ...it, pending: true };
        if (op.patch.category !== undefined) next.category = op.patch.category;
        if (op.patch.note !== undefined) next.note = op.patch.note || null;
        if (op.patch.details !== undefined) next.details = op.patch.details;
        return next;
      });
    } else {
      items = items.filter((it) => !sameKey(it, op.key));
    }
  }
  return { ...out, items, pending: true };
}

/** `GET /lists/mine` görünümü: çevrimdışı oluşturulan listeler başa eklenir, değişen listeler işaretlenir. */
export function overlayMine(base: ListSummary[], st: QueueState): ListSummary[] {
  if (!st.ops.length) return base;
  const delta = new Map<string, number>();
  const touched = new Set<string>();
  for (const op of st.ops) {
    if (!isListOp(op)) continue;
    const id = resolveId(op.listId, st.idMap);
    touched.add(id);
    const d = op.type === 'addItem' ? 1 : op.type === 'removeItem' ? -1 : 0;
    delta.set(id, (delta.get(id) ?? 0) + d);
  }
  const known = new Set(base.map((l) => String(l.id)));
  const created: ListSummary[] = opsFor(st, 'createList')
    .filter((o) => !known.has(resolveId(o.tempId, st.idMap)))
    .reverse()
    .map((o) => ({
      id: o.tempId, city: o.city, title: o.title, visibility: 'private', allowCopy: false, allowComments: true,
      itemCount: Math.max(0, delta.get(o.tempId) ?? 0), updatedAt: new Date(o.at).toISOString(), pending: true,
    }));
  const rest = base.map((l) => {
    const id = String(l.id);
    if (!touched.has(id)) return l;
    return { ...l, itemCount: Math.max(0, l.itemCount + (delta.get(id) ?? 0)), pending: true };
  });
  return [...created, ...rest];
}

/** `GET /places/:id` görünümü: bekleyen puan "Senin puanın"a, ortalamaya, adede ve dağılıma yansır. */
export function overlayPlace(base: PlaceDetail, placeId: string, st: QueueState): PlaceDetail {
  const rates = opsFor(st, 'rate').filter((o) => o.placeId === String(placeId));
  if (!rates.length) return base;
  const stars = rates[rates.length - 1].stars;
  const r = base.rating;
  const prev = r.mine;
  const sum = (r.avg ?? 0) * r.count;
  const count = prev === null ? r.count + 1 : r.count;
  const total = sum - (prev ?? 0) + stars;
  const dist = [1, 2, 3, 4, 5].map((s) => {
    const n = r.distribution.find((d) => d.stars === s)?.n ?? 0;
    return { stars: s, n: n - (prev === s ? 1 : 0) + (stars === s ? 1 : 0) };
  });
  return {
    ...base,
    rating: { ...r, mine: stars, count, avg: count ? Math.round((total / count) * 100) / 100 : null, distribution: dist, pending: true },
  };
}

/** `GET /places/:id/comments` görünümü (en yeni önce): bekleyen yorumlar başa eklenir. */
export function overlayComments(base: PlaceComment[], placeId: string, st: QueueState, user: OverlayUser | null): PlaceComment[] {
  const mine = opsFor(st, 'comment').filter((o) => o.placeId === String(placeId));
  if (!mine.length) return base;
  const pending: PlaceComment[] = mine.reverse().map((o) => ({
    id: o.tempId, parentId: null, body: o.body, visibility: o.visibility, createdAt: new Date(o.at).toISOString(),
    authorId: user?.id ?? '', author: user?.handle ?? '', photos: o.photos, pending: true,
  }));
  return [...pending, ...base];
}

/** Bir iş tamamlanınca tazelenecek GET yolları. */
export function affectedPaths(op: Op, idMap: Record<string, string>): string[] {
  if (isListOp(op)) return [`/lists/${resolveId(op.listId, idMap)}`, '/lists/mine'];
  if (op.type === 'createList') return ['/lists/mine'];
  if (op.type === 'rate') return [`/places/${op.placeId}`];
  return [`/places/${op.placeId}/comments`];
}
