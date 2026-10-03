import { api, hasToken, isNetworkError, refreshCache, toItemInput } from './api';
import { uploadImage } from './media';
import {
  getQueue, getUser, isDeviceOnline, isOnline, newId, offlineReady, onOnlineChange, pushOp, saveQueue, setSyncing,
} from './offlineStore';
import {
  affectedPaths, backoffMs, isLocalPhoto, isTemp, opPhotos, processQueue, resolveId,
  type Op, type OpInput, type QueueState, type SyncDeps,
} from './syncCore';

/**
 * Eşitleme motoru (AC-OFF-2/3). Kuyruk sırayla, tek seferde bir akışla işlenir: bağlantı gelince, uygulama açılınca
 * ve yeni iş eklenince. Geçici hatada (ağ, 429, 5xx) 2 s'den 60 s'ye artan aralıkla yeniden denenir; sunucuya
 * ulaşılamıyorsa (ağ var ama yanıt yok) aynı aralıkla yoklanır ve çevrimdışı şeridi yanıt gelince kalkar.
 */
class Cleared extends Error {}

const deps: SyncDeps = {
  createList: (city, title) => api.createList(city, title),
  getListItems: async (listId) => {
    const l = await api.fetchList(listId);
    return [...l.items].sort((a, b) => a.position - b.position).map((i) => toItemInput(l.city, i));
  },
  putItems: (listId, items) => api.putItems(listId, items),
  rate: (placeId, stars) => api.rate(placeId, stars),
  addComment: (placeId, body, visibility, photos) => api.addComment(placeId, body, visibility, photos),
  uploadPhoto: (p) => uploadImage(p),
  persist: async (state: QueueState) => {
    // Çıkış yapıldıysa (kuyruk silindi) eski durum geri yazılmaz.
    if (state !== getQueue()) throw new Cleared();
    await saveQueue();
  },
  afterOp: async (op) => {
    const paths = affectedPaths(op, getQueue().idMap);
    await Promise.all(paths.map((p) => refreshCache(p).catch(() => undefined)));
  },
};

let flushing: Promise<void> | null = null;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function stopTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
}

/** Geçici hatadan ya da ulaşılamayan sunucudan sonra bekleyip yeniden dener. */
function retryLater() {
  stopTimer();
  if (!isDeviceOnline()) return; // ağ gelince `online` olayı tetikler
  timer = setTimeout(() => {
    timer = null;
    if (getQueue().ops.length) { void flush(); return; }
    if (!isOnline()) {
      api.ping().then(() => { attempt = 0; }, () => retryLater());
    }
  }, backoffMs(attempt++));
}

/** Kuyruğu gönderir (zaten gönderiliyorsa aynı akışı döner). */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    await offlineReady();
    if (!getUser() || !hasToken() || !getQueue().ops.length || !isDeviceOnline()) return;
    stopTimer();
    setSyncing(true);
    try {
      const r = await processQueue(getQueue(), deps);
      if (r.status === 'retry') retryLater(); else attempt = 0;
    } catch (e) {
      if (!(e instanceof Cleared)) retryLater();
    } finally {
      setSyncing(false);
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

/** (app) düzeni açıkken çalışır: açılışta ve bağlantı her gelişinde gönderir, gidince yoklamaya başlar. */
export function startSync(): () => void {
  const off = onOnlineChange((on) => {
    if (on) { attempt = 0; void flush(); } else retryLater();
  });
  void offlineReady().then(() => { if (!isOnline()) retryLater(); void flush(); });
  return () => { off(); stopTimer(); };
}

function needsQueue(op: OpInput): boolean {
  const q = getQueue();
  if (!isOnline() || q.ops.length > 0) return true; // sıra korunur: bekleyen iş varken yeni iş de sıraya girer
  if (opPhotos(op).some(isLocalPhoto)) return true;
  if ((op.type === 'addItem' || op.type === 'updateItem' || op.type === 'removeItem') && isTemp(resolveId(op.listId, q.idMap))) return true;
  return false;
}

export async function enqueue(op: OpInput): Promise<void> {
  await pushOp({ ...op, id: newId('op'), at: Date.now() } as Op);
  if (isDeviceOnline()) void flush();
}

/**
 * Değişikliği çevrimiçiyse hemen (`direct`, ekranın her zamanki isteği) gönderir; çevrimdışıysa, sırada bekleyen iş
 * varsa ya da istek ağ hatasıyla düşerse niyeti sıraya alır (AC-OFF-2). Sunucu hataları (400/403/404 …) çağırana
 * aynen fırlatılır, böylece çevrimiçi davranış değişmez.
 */
export async function runOrQueue(op: OpInput, direct: () => Promise<unknown>): Promise<{ queued: boolean }> {
  await offlineReady();
  if (needsQueue(op)) {
    await enqueue(op);
    return { queued: true };
  }
  try {
    await direct();
    return { queued: false };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await enqueue(op);
    return { queued: true };
  }
}

export const tempId = (): string => newId('tmp-');
