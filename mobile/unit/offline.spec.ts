import { expect, test } from '@playwright/test';
import type { ItemInput, ListDetail, PlaceComment, PlaceDetail } from '../src/lib/api';
import {
  applyListOp, backoffMs, classifyStatus, emptyQueue, overlayComments, overlayList, overlayMine, overlayPlace,
  processQueue, rewritePath, type Op, type OpInput, type QueueState, type SyncDeps,
} from '../src/lib/syncCore';

// Node-only: src/lib/syncCore.ts is the pure queue / merge logic behind AC-OFF-1..3.

class HttpError extends Error {
  constructor(readonly status: number, msg = `HTTP ${status}`) { super(msg); }
}

let seq = 0;
const op = (o: OpInput): Op => ({ ...o, id: `op${++seq}`, at: 1_700_000_000_000 + seq } as Op);
const item = (name: string, extra: Partial<ItemInput> = {}): ItemInput => ({ provider: 'voyage', providerId: name.toLowerCase(), name, category: 'food', ...extra });
const key = (name: string) => ({ provider: 'voyage', providerId: name.toLowerCase() });
const user = { id: 7, handle: 'ayse' };

/** In-memory fake server for processQueue. */
function fakeServer() {
  const lists = new Map<string, ItemInput[]>();
  const ratings: Array<[string, number]> = [];
  const comments: Array<{ placeId: string; body: string; photos: string[] }> = [];
  const uploads: string[] = [];
  const calls: string[] = [];
  let nextList = 100;
  let failNext: Record<string, number[]> = {};
  const maybeFail = (name: string) => {
    const q = failNext[name];
    if (q?.length) { const s = q.shift()!; throw new HttpError(s); }
  };
  const persisted: QueueState[] = [];
  const deps: SyncDeps = {
    async createList(city, title) { calls.push(`create ${city}/${title}`); maybeFail('create'); const id = nextList++; lists.set(String(id), []); return { id }; },
    async getListItems(id) { calls.push(`get ${id}`); maybeFail('get'); const l = lists.get(id); if (!l) throw new HttpError(404, 'Not found'); return l.map((i) => ({ ...i })); },
    async putItems(id, items) { calls.push(`put ${id} ${items.map((i) => i.name).join(',')}`); maybeFail('put'); lists.set(id, items.map((i) => ({ ...i }))); return { ok: true }; },
    async rate(placeId, stars) { calls.push(`rate ${placeId} ${stars}`); maybeFail('rate'); ratings.push([placeId, stars]); return { ok: true }; },
    async addComment(placeId, body, _v, photos) { calls.push(`comment ${placeId} ${body} [${photos.join(',')}]`); maybeFail('comment'); comments.push({ placeId, body, photos }); return { id: comments.length }; },
    async uploadPhoto(p) { calls.push(`upload ${p.uri}`); maybeFail('upload'); const id = `m${uploads.length + 1}`.padEnd(32, '0'); uploads.push(p.uri); return id; },
    async persist(st) { persisted.push(JSON.parse(JSON.stringify(st))); },
    now: () => 42,
  };
  return { lists, ratings, comments, uploads, calls, deps, persisted, failOn: (f: Record<string, number[]>) => { failNext = f; } };
}

const state = (ops: Op[], extra: Partial<QueueState> = {}): QueueState => ({ ...emptyQueue(), ops, ...extra });

test.describe('AC-OFF-2: niyet sunucudaki güncel listeye yeniden uygulanır', () => {
  test('ekleme, düzenleme, çıkarma; başka cihazdan eklenen yer korunur', () => {
    const server = [item('A'), item('B'), item('Other', { note: 'başka cihaz' })];
    let r = applyListOp(server, op({ type: 'addItem', listId: '1', item: item('C', { note: 'yeni' }) }));
    expect(r).toEqual([...server, item('C', { note: 'yeni' })]);
    r = applyListOp(r as ItemInput[], op({ type: 'updateItem', listId: '1', key: key('A'), name: 'A', patch: { category: 'bar', note: 'not', details: { takeout: true } } }));
    expect((r as ItemInput[])[0]).toEqual({ ...item('A'), category: 'bar', note: 'not', details: { takeout: true } });
    r = applyListOp(r as ItemInput[], op({ type: 'removeItem', listId: '1', key: key('B'), name: 'B' }));
    expect((r as ItemInput[]).map((i) => i.name)).toEqual(['A', 'Other', 'C']);
  });

  test('aynı yer zaten listedeyse ikinci kez eklenmez; silinmiş yeri düzenlemek hata, çıkarmak sorun değil', () => {
    const server = [item('A', { note: 'eski' })];
    expect(applyListOp(server, op({ type: 'addItem', listId: '1', item: item('A', { note: 'yeni' }) }))).toEqual([item('A', { note: 'yeni' })]);
    expect(applyListOp(server, op({ type: 'updateItem', listId: '1', key: key('Z'), name: 'Z', patch: { note: 'x' } }))).toEqual({ error: 'Yer artık listede değil.' });
    expect(applyListOp(server, op({ type: 'removeItem', listId: '1', key: key('Z'), name: 'Z' }))).toEqual(server);
  });

  test('not ve detay boşaltılınca alan kaldırılır', () => {
    const r = applyListOp([item('A', { note: 'x', details: { dineIn: true } })], op({ type: 'updateItem', listId: '1', key: key('A'), name: 'A', patch: { note: null, details: {} } }));
    expect(r).toEqual([item('A')]);
  });

  test('hata sınıfları ve bekleme süresi', () => {
    expect([0, 408, 429, 500, 502, 503].map(classifyStatus)).toEqual(Array(6).fill('transient'));
    expect([400, 403, 404, 409, 413, 415].map(classifyStatus)).toEqual(Array(6).fill('permanent'));
    expect(classifyStatus(401)).toBe('auth');
    expect([0, 1, 2, 3, 10].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 60000]);
  });
});

test.describe('AC-OFF-2: kuyruk sırayla işlenir', () => {
  test('çevrimdışı oluşturulan listenin geçici kimliği oluşturulunca sonraki işlerde gerçek kimlikle değişir', async () => {
    const s = fakeServer();
    const st = state([
      op({ type: 'createList', tempId: 'tmp-a', city: 'Roma', title: 'Yeme' }),
      op({ type: 'addItem', listId: 'tmp-a', item: item('Roscioli') }),
      op({ type: 'addItem', listId: 'tmp-a', item: item('Pizzarium') }),
      op({ type: 'rate', placeId: '5', stars: 4 }),
    ]);
    const r = await processQueue(st, s.deps);
    expect(r).toEqual({ status: 'done', sent: 4, failed: 0 });
    expect(st.ops).toEqual([]);
    expect(st.idMap['tmp-a']).toBe('100');
    expect(s.lists.get('100')!.map((i) => i.name)).toEqual(['Roscioli', 'Pizzarium']);
    expect(s.calls).toEqual(['create Roma/Yeme', 'get 100', 'put 100 Roscioli', 'get 100', 'put 100 Roscioli,Pizzarium', 'rate 5 4']);
    // Her adım kalıcı yazılır: uygulama kapanırsa kaldığı yerden devam eder.
    expect(s.persisted.at(-1)!.ops).toEqual([]);
  });

  test('kalıcı hata (404/400/403) işi düşürür, kaydeder ve sıradakine geçer', async () => {
    const s = fakeServer();
    s.lists.set('1', [item('A')]);
    s.failOn({ rate: [400] });
    const st = state([
      op({ type: 'addItem', listId: '999', item: item('Kayıp'), listLabel: 'Roma · Silinen' }),
      op({ type: 'rate', placeId: '5', stars: 9 }),
      op({ type: 'updateItem', listId: '1', key: key('Yok'), name: 'Yok', patch: { note: 'x' } }),
      op({ type: 'addItem', listId: '1', item: item('B') }),
    ]);
    const r = await processQueue(st, s.deps);
    expect(r).toEqual({ status: 'done', sent: 1, failed: 3 });
    expect(st.failures.map((f) => f.label)).toEqual(['Yer ekleme: "Kayıp" (Roma · Silinen)', 'Puan: 9 yıldız', 'Yer düzenleme: "Yok"']);
    expect(st.failures[0].reason).toMatch(/Liste bulunamadı/);
    expect(st.failures[2].reason).toBe('Yer artık listede değil.');
    expect(s.lists.get('1')!.map((i) => i.name)).toEqual(['A', 'B']);
  });

  test('geçici hata (ağ / 5xx / 429) durur, iş sırada kalır; sonra kaldığı yerden devam eder', async () => {
    const s = fakeServer();
    s.lists.set('1', []);
    s.failOn({ put: [0], comment: [503] });
    const st = state([
      op({ type: 'addItem', listId: '1', item: item('A') }),
      op({ type: 'comment', placeId: '5', tempId: 'tmp-c', body: 'güzel', visibility: 'public', photos: [] }),
    ]);
    let r = await processQueue(st, s.deps);
    expect(r.status).toBe('retry');
    expect(st.ops).toHaveLength(2);
    r = await processQueue(st, s.deps);
    expect(r.status).toBe('retry');
    expect(st.ops).toHaveLength(1);
    r = await processQueue(st, s.deps);
    expect(r).toEqual({ status: 'done', sent: 1, failed: 0 });
    expect(s.lists.get('1')!.map((i) => i.name)).toEqual(['A']);
    expect(s.comments).toEqual([{ placeId: '5', body: 'güzel', photos: [] }]);
    expect(st.failures).toEqual([]);
  });

  test('401 kuyruğu durdurur (oturum bitti), işler silinmez', async () => {
    const s = fakeServer();
    s.failOn({ rate: [401] });
    const st = state([op({ type: 'rate', placeId: '5', stars: 3 })]);
    expect((await processQueue(st, s.deps)).status).toBe('auth');
    expect(st.ops).toHaveLength(1);
  });

  test('oluşturulamayan listeye bağlı işler de raporlanır', async () => {
    const s = fakeServer();
    s.failOn({ create: [400] });
    const st = state([
      op({ type: 'createList', tempId: 'tmp-x', city: '', title: 'Boş' }),
      op({ type: 'addItem', listId: 'tmp-x', item: item('A') }),
    ]);
    const r = await processQueue(st, s.deps);
    expect(r).toEqual({ status: 'done', sent: 0, failed: 2 });
    expect(st.failures[1].reason).toBe('Liste oluşturulamadığı için gönderilemedi.');
  });

  test('işlerken eklenen iş de aynı turda gönderilir', async () => {
    const s = fakeServer();
    const st = state([op({ type: 'rate', placeId: '1', stars: 2 })]);
    const rate = s.deps.rate;
    s.deps.rate = async (p, n) => { const r = await rate(p, n); if (p === '1') st.ops = [...st.ops, op({ type: 'rate', placeId: '2', stars: 5 })]; return r; };
    await processQueue(st, s.deps);
    expect(s.ratings).toEqual([['1', 2], ['2', 5]]);
  });
});

test.describe('AC-OFF-3: çevrimdışı fotoğraflar önce yüklenir, kimlikleri işe yazılır', () => {
  test('öğe ve yorum fotoğrafları', async () => {
    const s = fakeServer();
    s.lists.set('1', []);
    const st = state([
      op({ type: 'addItem', listId: '1', item: item('A', { details: { photos: ['local:p1', 'abc'.padEnd(32, '0')] } }) }),
      op({ type: 'comment', placeId: '5', tempId: 'tmp-c', body: '', visibility: 'friends', photos: ['local:p2'] }),
    ], { photos: { 'local:p1': { uri: 'file:///p1.jpg', type: 'image/jpeg' }, 'local:p2': { uri: 'file:///p2.jpg', type: 'image/jpeg' } } });
    const r = await processQueue(st, s.deps);
    expect(r.status).toBe('done');
    const m1 = 'm1'.padEnd(32, '0');
    const m2 = 'm2'.padEnd(32, '0');
    expect(s.lists.get('1')![0].details!.photos).toEqual([m1, 'abc'.padEnd(32, '0')]);
    expect(s.comments[0].photos).toEqual([m2]);
    expect(st.photos).toEqual({});
    expect(st.idMap['local:p1']).toBe(m1);
  });

  test('yükleme ağ hatasında iş bekler; yüklenen fotoğraf yeniden yüklenmez', async () => {
    const s = fakeServer();
    s.lists.set('1', []);
    s.failOn({ put: [0] });
    const st = state([op({ type: 'addItem', listId: '1', item: item('A', { details: { photos: ['local:p1'] } }) })],
      { photos: { 'local:p1': { uri: 'file:///p1.jpg', type: 'image/jpeg' } } });
    expect((await processQueue(st, s.deps)).status).toBe('retry');
    expect((await processQueue(st, s.deps)).status).toBe('done');
    expect(s.uploads).toEqual(['file:///p1.jpg']);
    expect(s.lists.get('1')![0].details!.photos).toEqual(['m1'.padEnd(32, '0')]);
  });

  test('kalıcı yükleme hatası (415) fotoğrafı düşürür, iş fotoğrafsız gider ve bildirilir', async () => {
    const s = fakeServer();
    s.failOn({ upload: [415] });
    const st = state([op({ type: 'comment', placeId: '5', tempId: 'tmp-c', body: 'metin', visibility: 'public', photos: ['local:p1'] })],
      { photos: { 'local:p1': { uri: 'file:///x.gif', type: 'image/gif' } } });
    const r = await processQueue(st, s.deps);
    expect(r.status).toBe('done');
    expect(s.comments).toEqual([{ placeId: '5', body: 'metin', photos: [] }]);
    expect(st.failures).toHaveLength(1);
    expect(st.failures[0].label).toMatch(/^Fotoğraf · Yorum/);
  });
});

test.describe('AC-OFF-1/2: görünüm = önbellek + bekleyen işler', () => {
  const base: ListDetail = {
    id: 1, ownerId: 7, ownerHandle: 'ayse', city: 'Roma', title: 'Yeme', visibility: 'private', allowCopy: false, allowComments: true,
    items: [
      { placeId: 10, provider: 'voyage', providerId: 'a', name: 'A', lat: null, lon: null, category: 'food', note: null, position: 0, details: {} },
      { placeId: 11, provider: 'voyage', providerId: 'b', name: 'B', lat: 41.9, lon: 12.5, category: 'bar', note: null, position: 1, details: {} },
    ],
  };

  test('liste: eklenen yer bekleyen işaretiyle sona eklenir, düzenlenen işaretlenir, çıkarılan kaybolur', () => {
    const st = state([
      op({ type: 'addItem', listId: '1', item: item('C', { lat: 1, lon: 2, note: 'n' }) }),
      op({ type: 'updateItem', listId: '1', key: key('A'), name: 'A', patch: { note: 'yeni not' } }),
      op({ type: 'removeItem', listId: '1', key: key('B'), name: 'B' }),
      op({ type: 'addItem', listId: '2', item: item('Başka liste') }),
    ]);
    const v = overlayList(base, '1', st, user)!;
    expect(v.items.map((i) => [i.name, !!i.pending, i.note])).toEqual([['A', true, 'yeni not'], ['C', true, 'n']]);
    expect(v.items[1]).toMatchObject({ lat: 1, lon: 2, position: 2, category: 'food' });
    expect(String(v.items[1].placeId)).toMatch(/^tmp-/);
    expect(overlayList(base, '1', emptyQueue(), user)).toBe(base);
  });

  test('çevrimdışı oluşturulan liste kuyruktan kurulur; eşlenince gerçek kimlikle de bulunur', () => {
    const st = state([op({ type: 'createList', tempId: 'tmp-n', city: 'Paris', title: 'Müzeler' }), op({ type: 'addItem', listId: 'tmp-n', item: item('Louvre') })]);
    const v = overlayList(null, 'tmp-n', st, user)!;
    expect(v).toMatchObject({ id: 'tmp-n', city: 'Paris', title: 'Müzeler', ownerId: 7, ownerHandle: 'ayse', visibility: 'private', pending: true });
    expect(v.items.map((i) => i.name)).toEqual(['Louvre']);
    expect(overlayList(null, 'tmp-zzz', st, user)).toBeNull();
    // createList gönderildi (kuyruktan çıktı), ekleme bekliyor: gerçek kimlikli liste görünümüne eklenir.
    const after = state([st.ops[1]], { idMap: { 'tmp-n': '55' } });
    expect(overlayList({ ...base, id: 55, items: [] }, '55', after, user)!.items.map((i) => i.name)).toEqual(['Louvre']);
    expect(rewritePath('/lists/tmp-n', after.idMap)).toBe('/lists/55');
    expect(rewritePath('/lists/tmp-q', after.idMap)).toBe('/lists/tmp-q');
  });

  test('listelerim: yeni liste başa, değişen listede adet ve işaret', () => {
    const mine = [{ id: 1, city: 'Roma', title: 'Yeme', visibility: 'private' as const, allowCopy: false, allowComments: true, itemCount: 2, updatedAt: '' }];
    const st = state([
      op({ type: 'createList', tempId: 'tmp-n', city: 'Paris', title: 'Müzeler' }),
      op({ type: 'addItem', listId: 'tmp-n', item: item('Louvre') }),
      op({ type: 'removeItem', listId: '1', key: key('A'), name: 'A' }),
    ]);
    const v = overlayMine(mine, st);
    expect(v.map((l) => [l.id, l.itemCount, !!l.pending])).toEqual([['tmp-n', 1, true], [1, 1, true]]);
  });

  test('puan: ortalama, adet, dağılım ve "Senin puanın"', () => {
    const p: PlaceDetail = {
      place: { id: 5, name: 'A', lat: null, lon: null, category: 'food', city: 'Roma' },
      rating: { count: 2, avg: 4, distribution: [{ stars: 5, n: 1 }, { stars: 3, n: 1 }], mine: null },
    };
    const first = overlayPlace(p, '5', state([op({ type: 'rate', placeId: '5', stars: 2 })]));
    expect(first.rating).toMatchObject({ count: 3, avg: 3.33, mine: 2, pending: true });
    expect(first.rating.distribution.find((d) => d.stars === 2)!.n).toBe(1);
    const changed = overlayPlace({ ...p, rating: { ...p.rating, mine: 3 } }, '5', state([op({ type: 'rate', placeId: '5', stars: 5 }), op({ type: 'rate', placeId: '5', stars: 1 })]));
    expect(changed.rating).toMatchObject({ count: 2, avg: 3, mine: 1 });
    expect(changed.rating.distribution.find((d) => d.stars === 3)!.n).toBe(0);
    expect(overlayPlace(p, '6', state([op({ type: 'rate', placeId: '5', stars: 2 })]))).toBe(p);
  });

  test('yorumlar: bekleyen yorum en üstte, yazan ben', () => {
    const base: PlaceComment[] = [{ id: 1, parentId: null, body: 'eski', visibility: 'public', createdAt: '2024-01-01T00:00:00Z', authorId: 2, author: 'mehmet', photos: [] }];
    const st = state([
      op({ type: 'comment', placeId: '5', tempId: 'tmp-1', body: 'ilk', visibility: 'friends', photos: ['local:x'] }),
      op({ type: 'comment', placeId: '5', tempId: 'tmp-2', body: 'ikinci', visibility: 'public', photos: [] }),
    ]);
    const v = overlayComments(base, '5', st, user);
    expect(v.map((c) => [c.body, c.author, !!c.pending])).toEqual([['ikinci', 'ayse', true], ['ilk', 'ayse', true], ['eski', 'mehmet', false]]);
    expect(v[1].photos).toEqual(['local:x']);
  });
});
