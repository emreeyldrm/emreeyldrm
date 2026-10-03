import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { discardAllPhotos, persistPhoto } from './localPhotos';
import { initialDeviceOnline, watchDeviceOnline } from './netStatus';
import { emptyQueue, LOCAL_PREFIX, type Failure, type LocalPhoto, type Op, type OverlayUser, type QueueState } from './syncCore';

/**
 * Çevrimdışı durum (AC-OFF-1..5): bağlantı, GET önbelleği, bekleyen iş kuyruğu ve gönderilemeyenler.
 * Hepsi AsyncStorage'da (native: dosya, web: localStorage); Expo Go'da ve web'de aynı çalışır.
 *
 *  voyage.cache.<yol>    { t, data }  başarılı GET yanıtı (yol = `/lists/12`, `/places/5/comments` …)
 *  voyage.queue          QueueState   sıralı işler, geçici kimlik eşlemesi, yerel fotoğraflar, hatalar
 *  voyage.offline.meta   { lastSync, owner }
 */
const CACHE_PREFIX = 'voyage.cache.';
const QUEUE_KEY = 'voyage.queue';
const META_KEY = 'voyage.offline.meta';
const PLAN_PREFIX = 'voyage.plan.';

interface Meta { lastSync: number | null; owner: string | null }
export interface CacheEntry<T = unknown> { t: number; data: T }

let queue: QueueState = emptyQueue();
let meta: Meta = { lastSync: null, owner: null };
let deviceOnline = initialDeviceOnline();
let reachable = true;
let syncing = false;
let version = 0;
let user: OverlayUser | null = null;
let ready: Promise<void> | null = null;
let metaWrittenAt = 0;
const listeners = new Set<() => void>();
const onlineListeners = new Set<(online: boolean) => void>();

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
async function writeJson(key: string, value: unknown): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch { /* depolama dolu/yok: bellekte kalır */ }
}

/** Kalıcı durumu bir kez yükler ve cihaz bağlantısını izlemeye başlar. */
export function offlineReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const [q, m] = await Promise.all([readJson<QueueState>(QUEUE_KEY), readJson<Meta>(META_KEY)]);
      if (q && Array.isArray(q.ops)) queue = { ...emptyQueue(), ...q };
      if (m) meta = { lastSync: m.lastSync ?? null, owner: m.owner ?? null };
      watchDeviceOnline(setDeviceOnline);
      emit();
    })();
  }
  return ready;
}

// ---- bağlantı -------------------------------------------------------------------------------------------------

/** Cihaz çevrimiçi ve sunucuya son istek ulaştı. */
export const isOnline = (): boolean => deviceOnline && reachable;
/** Cihazın ağı var mı (sunucuya ulaşılamıyor olsa bile istek denenebilir). */
export const isDeviceOnline = (): boolean => deviceOnline;

function setDeviceOnline(on: boolean) {
  if (on === deviceOnline) return;
  const was = isOnline();
  deviceOnline = on;
  // Ağ geri geldi: sunucunun da ulaşılabilir olduğunu varsayıp deneriz (ilk hata yine çevrimdışına alır).
  if (on) reachable = true;
  changed(was);
}

/** İstek katmanı her yanıtta (true) ya da ağ hatasında (false) çağırır. */
export function markReachable(ok: boolean): void {
  if (ok) {
    const now = Date.now();
    meta.lastSync = now;
    if (now - metaWrittenAt > 5000) { metaWrittenAt = now; void writeJson(META_KEY, meta); }
  }
  if (ok === reachable) return;
  const was = isOnline();
  reachable = ok;
  if (!ok) void writeJson(META_KEY, meta);
  changed(was);
}

function changed(was: boolean) {
  const now = isOnline();
  if (was !== now) onlineListeners.forEach((f) => f(now));
  emit();
}

export function onOnlineChange(fn: (online: boolean) => void): () => void {
  onlineListeners.add(fn);
  return () => { onlineListeners.delete(fn); };
}

// ---- önbellek -------------------------------------------------------------------------------------------------

export async function readCache<T>(path: string): Promise<CacheEntry<T> | null> {
  return readJson<CacheEntry<T>>(CACHE_PREFIX + path);
}
/** Oturum yokken (çıkış sırasında biten istekler) yazılmaz; `force` oturum açılırken kullanıcıyı saklamak için. */
export async function writeCache(path: string, data: unknown, force = false): Promise<void> {
  if (!user && !force) return;
  await writeJson(CACHE_PREFIX + path, { t: Date.now(), data });
}
export async function removeCache(path: string): Promise<void> {
  try { await AsyncStorage.removeItem(CACHE_PREFIX + path); } catch { /* yok say */ }
}

// ---- kuyruk ---------------------------------------------------------------------------------------------------

export const getQueue = (): QueueState => queue;

export async function saveQueue(): Promise<void> {
  await writeJson(QUEUE_KEY, queue);
  emit();
}

let opSeq = 0;
export const newId = (prefix = ''): string =>
  `${prefix}${Date.now().toString(36)}${(opSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function pushOp(op: Op): Promise<void> {
  await offlineReady();
  queue.ops = [...queue.ops, op];
  await saveQueue();
}

export async function keepPhoto(ref: string, photo: LocalPhoto): Promise<void> {
  await offlineReady();
  queue.photos = { ...queue.photos, [ref]: photo };
  await saveQueue();
}
/**
 * Çevrimdışı seçilen fotoğrafı (AC-OFF-3) kalıcı yere kopyalar ve kuyruğa kaydeder; medya kimliği yerine
 * kullanılacak `local:<ref>` başvurusunu döner. Bağlantı gelince ilgili iş gönderilmeden önce yüklenir.
 */
export async function keepLocalPhoto(photo: LocalPhoto): Promise<string> {
  const ref = `${LOCAL_PREFIX}${newId()}`;
  const uri = await persistPhoto(photo.uri, ref);
  await keepPhoto(ref, { uri, type: photo.type });
  return ref;
}

/** `local:<ref>` için gösterilecek adres (yüklenmediyse yerel dosya, yüklendiyse medya kimliği). */
export function localPhoto(ref: string): { uri?: string; mediaId?: string } {
  const mediaId = queue.idMap[ref];
  if (mediaId) return { mediaId };
  return { uri: queue.photos[ref]?.uri };
}

export async function dismissFailures(): Promise<void> {
  queue.failures = [];
  await saveQueue();
}

export function setSyncing(on: boolean): void {
  if (on === syncing) return;
  syncing = on;
  emit();
}

// ---- kullanıcı ------------------------------------------------------------------------------------------------

export const getUser = (): OverlayUser | null => user;
/** Oturum açan kullanıcı. Başka bir kullanıcının cihazda kalan verisi (önbellek, sıra) önce silinir. */
export async function setUser(u: OverlayUser | null): Promise<void> {
  await offlineReady();
  if (u && meta.owner !== String(u.id)) {
    if (meta.owner !== null) await clearOffline();
    meta.owner = String(u.id);
    await writeJson(META_KEY, meta);
  }
  user = u;
  emit();
}

/** Çıkış / hesap silme (AC-OFF-5): önbellek, bekleyen sıra ve yerel fotoğraflar silinir; hesap silinince planlar da. */
export async function clearOffline(opts: { plans?: boolean } = {}): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const drop = keys.filter((k) => k.startsWith(CACHE_PREFIX) || k === QUEUE_KEY || k === META_KEY || (opts.plans && k.startsWith(PLAN_PREFIX)));
    if (drop.length) await AsyncStorage.multiRemove(drop);
  } catch { /* yok say */ }
  discardAllPhotos();
  queue = emptyQueue();
  meta = { lastSync: null, owner: null };
  user = null;
  emit();
}

// ---- React ----------------------------------------------------------------------------------------------------

export interface OfflineSnapshot {
  online: boolean;
  lastSync: number | null;
  pending: number;
  failures: Failure[];
  syncing: boolean;
  /** Kuyruk ya da bağlantı her değiştiğinde artar: ekranlar veriyi yeniden yükler. */
  version: number;
}
let snapshot: OfflineSnapshot = build();
function build(): OfflineSnapshot {
  return { online: isOnline(), lastSync: meta.lastSync, pending: queue.ops.length, failures: queue.failures, syncing, version };
}
function emit() {
  version++;
  snapshot = build();
  listeners.forEach((f) => f());
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useOffline(): OfflineSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Yalnızca kuyruk içeriği ya da bağlantı değişince artan sayaç (yeniden yükleme tetikleyicisi). */
export function useDataVersion(): string {
  const s = useOffline();
  return `${s.online ? 1 : 0}:${s.pending}:${s.failures.length}:${s.syncing ? 1 : 0}`;
}

/** "14:32" */
export function formatClock(t: number | null): string {
  if (!t) return '—';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
