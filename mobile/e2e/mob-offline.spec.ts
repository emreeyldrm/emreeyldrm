import { expect, request, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { addPlace, comment, createList, png, register, tid, uniq } from './helpers';

// Çevrimdışı çalışma (docs/ACCEPTANCE.md, OFF): AC-OFF-1..5.
// İki tür bağlantı kaybı denenir: `context.setOffline(true)` (navigator.onLine = false, ağ kapalı) ve uygulama açıkken
// sunucuya ulaşılamaması (API isteklerini `route.abort` ile düşürerek; statik web derlemesi yüklenmeye devam eder,
// böylece "uygulamayı internetsiz yeniden açma" da denenebilir). Sunucu tarafı doğrulamalar ikinci bir "cihaz" gibi
// doğrudan API'ye (aynı kullanıcının token'ı ile) yapılır.

const apiUrl = () => test.info().config.metadata.apiUrl as string;
const BANNER = /^Çevrimdışı · son güncelleme \d{2}:\d{2}$/;

async function apiAs(page: Page): Promise<APIRequestContext> {
  const token = await page.evaluate(() => localStorage.getItem('voyage.token'));
  expect(token).toBeTruthy();
  return request.newContext({ baseURL: apiUrl(), extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}
const idFromUrl = (page: Page, kind: 'lists' | 'places') => new RegExp(`/${kind}/(\\d+)`).exec(page.url())![1];

/** Sunucuya ulaşılamıyor: API istekleri ağ hatasıyla düşer (statik dosyalar yüklenir). */
async function cutServer(context: BrowserContext) {
  await context.route(`${apiUrl()}/**`, (r) => r.abort('internetdisconnected'));
}
async function restoreServer(context: BrowserContext) {
  await context.unroute(`${apiUrl()}/**`);
}

async function listNames(api: APIRequestContext, listId: string): Promise<string[]> {
  const res = await api.get(`/lists/${listId}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()).items as { name: string }[]).map((i) => i.name);
}

/** Liste ekranından Listelerim'e (sekme çubuğu yığın ekranlarında gizli). */
async function backToLists(page: Page) {
  await tid(page, 'back').click();
  await expect(tid(page, 'tab-bar')).toBeVisible();
  await tid(page, 'tab-lists').click();
  await expect(tid(page, 'list-new')).toBeVisible();
}

/** createList yardımcısının sayfa yüklemeden (çevrimdışı da çalışan) hâli: Listelerim'de olmalı. */
async function createListInApp(page: Page, city: string, title: string) {
  if (!(await tid(page, 'list-create-form').isVisible())) await tid(page, 'list-new').click();
  await tid(page, 'list-city').fill(city);
  await tid(page, 'list-title').fill(title);
  await tid(page, 'list-create').click();
  await tid(page, 'list-card').filter({ hasText: title }).click();
  await expect(tid(page, 'list-detail-title')).toHaveText(title);
}

const COLORS: [number, number, number][] = [[46, 125, 91], [242, 140, 40], [47, 95, 158]];
const photo = (i: number) => ({ name: `foto-${i}.png`, mimeType: 'image/png', buffer: png(40 + i, 30 + i, COLORS[i % COLORS.length]) });
async function choosePhoto(page: Page, button: Locator, i = 0) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles([photo(i)]);
}
async function expectLoadedImages(scope: Locator, n: number) {
  const imgs = scope.locator('img');
  await expect(imgs).toHaveCount(n);
  for (let i = 0; i < n; i++) {
    await expect.poll(() => imgs.nth(i).evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
}
const storageKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage));

test('AC-OFF-1: açılmış listeler, liste detayı, plan ve yer sayfası (puan, yorumlar) internetsiz son hâliyle görünür; üstte "Çevrimdışı · son güncelleme" şeridi', async ({ page, context }) => {
  await register(page);
  const R = `Roscioli ${uniq('r')}`;
  await createList(page, 'Roma', 'Çevrimdışı Roma');
  await addPlace(page, R, 'food', 'carbonara');
  await addPlace(page, 'Pantheon', 'historic', '', { lat: 41.8986, lon: 12.4769 });
  await tid(page, 'seg-plan').click();
  const day1 = tid(page, 'plan-day-1');
  await day1.getByTestId('plan-add-1').click();
  await day1.getByTestId('plan-pick').filter({ hasText: 'Pantheon' }).click();
  await expect(day1.getByTestId('plan-item-name')).toHaveText(['Pantheon']);
  await tid(page, 'seg-list').click();
  await tid(page, 'place-link').filter({ hasText: R }).click();
  await tid(page, 'star-4').click();
  await expect(tid(page, 'rating-count')).toHaveText('1');
  await comment(page, 'Harika carbonara', 'Herkes');
  await expect(tid(page, 'offline-banner')).toHaveCount(0);

  // 1) Uygulama açıkken bağlantı gider: şerit çıkar, açılmış ekranlar önbellekten gelir.
  await context.setOffline(true);
  await expect(tid(page, 'offline-banner-text')).toHaveText(BANNER);
  await tid(page, 'back').click();
  await expect(tid(page, 'list-detail-title')).toHaveText('Çevrimdışı Roma');
  await expect(tid(page, 'place-item')).toHaveCount(2);
  await context.setOffline(false);
  await expect(tid(page, 'offline-banner')).toHaveCount(0);

  // 2) Uygulama internetsiz yeniden açılır (sunucuya ulaşılamıyor): oturum ve veriler cihazdan gelir.
  await cutServer(context);
  await page.goto('/lists');
  await expect(tid(page, 'offline-banner-text')).toHaveText(BANNER);
  await expect(tid(page, 'current-handle')).toBeVisible();
  await tid(page, 'list-card').filter({ hasText: 'Çevrimdışı Roma' }).click();
  await expect(tid(page, 'list-detail-title')).toHaveText('Çevrimdışı Roma');
  await expect(tid(page, 'place-item-name')).toHaveText([R, 'Pantheon']);
  await expect(tid(page, 'place-item-note')).toHaveText('carbonara');
  await tid(page, 'seg-plan').click();
  await expect(tid(page, 'plan-day-1').getByTestId('plan-item-name')).toHaveText(['Pantheon']);
  await tid(page, 'seg-list').click();
  await tid(page, 'place-link').filter({ hasText: R }).click();
  await expect(tid(page, 'place-title')).toHaveText(R);
  await expect(tid(page, 'rating-avg')).toHaveText('4,0');
  await expect(tid(page, 'star-4')).toHaveAttribute('aria-checked', 'true');
  await expect(tid(page, 'comment').filter({ hasText: 'Harika carbonara' })).toBeVisible();
  await expect(tid(page, 'offline-banner')).toBeVisible();

  // Hiç açılmamış sayfa: çökmez, anlaşılır mesaj.
  await page.goto('/places/987654321');
  await expect(tid(page, 'error')).toContainText('daha önce açılmadığı');

  // Sunucu geri gelince şerit kalkar.
  await restoreServer(context);
  await page.goto('/lists');
  await expect(tid(page, 'list-card').filter({ hasText: 'Çevrimdışı Roma' })).toBeVisible();
  await expect(tid(page, 'offline-banner')).toHaveCount(0);
});

test('AC-OFF-2: çevrimdışı değişiklikler hemen "Eşitlenmeyi bekliyor" ile görünür, bağlantı gelince sırayla gider; başka cihazın değişikliği korunur', async ({ page, context }) => {
  await register(page);
  // Yerler kullanıcılar arasında paylaşılır (aynı sağlayıcı kimliği = aynı yer): puan sayısı için benzersiz ad.
  const R = `Roscioli ${uniq('r')}`;
  await createList(page, 'Roma', 'Ortak Roma');
  await addPlace(page, R, 'food');
  await addPlace(page, 'Silinecek Yer', 'bar');
  const listId = idFromUrl(page, 'lists');
  await tid(page, 'place-link').filter({ hasText: R }).click();
  await expect(tid(page, 'place-title')).toHaveText(R);
  const placeId = idFromUrl(page, 'places');
  await tid(page, 'back').click();
  await expect(tid(page, 'list-detail-title')).toHaveText('Ortak Roma');

  await context.setOffline(true);
  await expect(tid(page, 'offline-banner')).toBeVisible();

  // Yer ekleme (arama çevrimdışı devre dışı, elle eklenir).
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  await sheet.getByTestId('place-name').fill('Pizzarium');
  await expect(sheet.getByTestId('place-suggest-offline')).toBeVisible();
  await sheet.getByTestId('place-cat-food').click();
  await sheet.getByTestId('place-note').fill('offline not');
  await sheet.getByTestId('place-add').click();
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);
  const added = tid(page, 'place-item').filter({ hasText: 'Pizzarium' });
  await expect(added.getByTestId('pending-badge')).toHaveText('Eşitlenmeyi bekliyor');

  // Düzenleme ve çıkarma.
  await tid(page, 'place-item').filter({ hasText: R }).getByTestId('place-edit').click();
  await page.getByTestId('add-place-sheet').getByTestId('place-note').fill('yeni not');
  await page.getByTestId('add-place-sheet').getByTestId('place-save').click();
  const edited = tid(page, 'place-item').filter({ hasText: R });
  await expect(edited.getByTestId('place-item-note')).toHaveText('yeni not');
  await expect(edited.getByTestId('pending-badge')).toBeVisible();
  await tid(page, 'place-item').filter({ hasText: 'Silinecek Yer' }).getByTestId('place-remove').click();
  await expect(tid(page, 'place-item').filter({ hasText: 'Silinecek Yer' })).toHaveCount(0);
  await expect(tid(page, 'offline-pending')).toHaveText('· 3 değişiklik bekliyor');

  // Puan ve yorum.
  await tid(page, 'place-link').filter({ hasText: R }).click();
  await tid(page, 'star-5').click();
  await expect(tid(page, 'rating-pending')).toBeVisible();
  await expect(tid(page, 'star-5')).toHaveAttribute('aria-checked', 'true');
  await expect(tid(page, 'rating-count')).toHaveText('1');
  await tid(page, 'comment-body').fill('Çevrimdışı yorum');
  await tid(page, 'comment-submit').click();
  const pendingComment = tid(page, 'comment').filter({ hasText: 'Çevrimdışı yorum' });
  await expect(pendingComment.getByTestId('pending-badge')).toBeVisible();
  await tid(page, 'back').click();

  // Liste oluşturma ve yeni listeye yer ekleme.
  await backToLists(page);
  await createListInApp(page, 'Paris', 'Çevrimdışı Paris');
  await expect(tid(page, 'list-pending')).toBeVisible();
  await addPlace(page, 'Louvre', 'museum');
  await expect(tid(page, 'place-item').filter({ hasText: 'Louvre' }).getByTestId('pending-badge')).toBeVisible();
  await expect(tid(page, 'offline-pending')).toHaveText('· 7 değişiklik bekliyor');

  // Bu arada başka bir cihaz Roma listesine yer ekler.
  const api = await apiAs(page);
  const cur = await (await api.get(`/lists/${listId}`)).json();
  const other = { provider: 'voyage', providerId: 'baska cihaz kafe@roma', name: 'Başka Cihaz Kafe', category: 'coffee', city: 'Roma' };
  const keep = (cur.items as Array<Record<string, unknown>>).map((i) => ({ provider: i.provider, providerId: i.providerId, name: i.name, category: i.category, city: 'Roma' }));
  expect((await api.put(`/lists/${listId}/items`, { data: { items: [...keep, other] } })).ok()).toBe(true);

  await context.setOffline(false);
  await expect(tid(page, 'offline-banner')).toHaveCount(0);
  await expect(tid(page, 'place-item').filter({ hasText: 'Louvre' })).toBeVisible();
  await expect(tid(page, 'pending-badge')).toHaveCount(0, { timeout: 20_000 });
  await expect(tid(page, 'sync-failures')).toHaveCount(0);

  // Sunucu: niyetler güncel listeye uygulandı, başka cihazın yeri duruyor.
  await expect.poll(() => listNames(api, listId)).toEqual([R, 'Başka Cihaz Kafe', 'Pizzarium']);
  const roma = await (await api.get(`/lists/${listId}`)).json();
  expect(roma.items.find((i: { name: string }) => i.name === R).note).toBe('yeni not');
  expect(roma.items.find((i: { name: string }) => i.name === 'Pizzarium').note).toBe('offline not');
  expect((await (await api.get(`/places/${placeId}`)).json()).rating.mine).toBe(5);
  const comments = await (await api.get(`/places/${placeId}/comments`)).json();
  expect(comments.map((c: { body: string }) => c.body)).toContain('Çevrimdışı yorum');
  const mine = await (await api.get('/lists/mine')).json() as Array<{ id: number; title: string }>;
  const paris = mine.find((l) => l.title === 'Çevrimdışı Paris');
  expect(paris).toBeTruthy();
  expect(await listNames(api, String(paris!.id))).toEqual(['Louvre']);

  // Ekran da sunucudaki hâle döner (geçici kimlik yerine gerçek kimlik).
  await backToLists(page);
  await expect(tid(page, 'list-card').filter({ hasText: 'Çevrimdışı Paris' }).getByTestId('pending-badge')).toHaveCount(0);
  await api.dispose();
});

test('AC-OFF-2: kalıcı hata (silinmiş liste) sıradaki işi durdurmaz; gönderilemeyen değişiklik kullanıcıya gösterilir', async ({ page, context }) => {
  await register(page);
  await createList(page, 'Roma', 'Silinecek Liste');
  await addPlace(page, 'Eski Yer', 'food');
  const doomed = idFromUrl(page, 'lists');
  await createList(page, 'Milano', 'Kalan Liste');
  await addPlace(page, 'Duomo', 'historic');
  const kept = idFromUrl(page, 'lists');

  await context.setOffline(true);
  await backToLists(page);
  await tid(page, 'list-card').filter({ hasText: 'Silinecek Liste' }).click();
  await addPlace(page, 'Yeni Yer', 'bar');
  await backToLists(page);
  await tid(page, 'list-card').filter({ hasText: 'Kalan Liste' }).click();
  await addPlace(page, 'Luini', 'food');

  const api = await apiAs(page);
  expect((await api.delete(`/lists/${doomed}`)).ok()).toBe(true);
  await context.setOffline(false);

  const notice = tid(page, 'sync-failures');
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toContainText('Bir değişiklik gönderilemedi');
  await expect(notice.getByTestId('sync-failure')).toHaveText([/Yer ekleme: "Yeni Yer" \(Roma · Silinecek Liste\) — Liste bulunamadı/]);
  await expect.poll(() => listNames(api, kept)).toEqual(['Duomo', 'Luini']);
  await expect(tid(page, 'place-item').filter({ hasText: 'Luini' }).getByTestId('pending-badge')).toHaveCount(0);
  await notice.getByTestId('sync-failures-dismiss').click();
  await expect(tid(page, 'sync-failures')).toHaveCount(0);
  await api.dispose();
});

test('AC-OFF-3: çevrimdışı eklenen fotoğraflar sıraya alınır, uygulama yeniden açılsa da kalır, bağlantı gelince yüklenip öğeye ve yoruma bağlanır', async ({ page, context }) => {
  await register(page);
  await createList(page, 'Roma', 'Foto Roma');
  await addPlace(page, 'Gelateria', 'food');
  const listId = idFromUrl(page, 'lists');
  await tid(page, 'place-link').filter({ hasText: 'Gelateria' }).click();
  const placeId = idFromUrl(page, 'places');
  await tid(page, 'back').click();

  await context.setOffline(true);
  await expect(tid(page, 'offline-banner')).toBeVisible();
  await tid(page, 'place-item').filter({ hasText: 'Gelateria' }).getByTestId('place-edit').click();
  const sheet = page.getByTestId('add-place-sheet');
  await choosePhoto(page, sheet.getByTestId('place-photos-add-library'), 0);
  await expect(sheet.getByTestId('place-photos-queued')).toHaveCount(1);
  await sheet.getByTestId('place-save').click();
  const row = tid(page, 'place-item').filter({ hasText: 'Gelateria' });
  await expect(row.getByTestId('pending-badge')).toBeVisible();
  await expectLoadedImages(row.getByTestId('place-item-photos'), 1);

  await tid(page, 'place-link').filter({ hasText: 'Gelateria' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tid(page, 'comment-photo').click()]);
  await chooser.setFiles([photo(1)]);
  await expect(tid(page, 'comment-photo-strip-queued')).toHaveCount(1);
  await tid(page, 'comment-body').fill('Fotoğraflı çevrimdışı yorum');
  await tid(page, 'comment-submit').click();
  const c = tid(page, 'comment').filter({ hasText: 'Fotoğraflı çevrimdışı yorum' });
  await expect(c.getByTestId('pending-badge')).toBeVisible();
  await expectLoadedImages(c.getByTestId('comment-photos'), 1);

  // Uygulama internetsiz yeniden açılır: sıra ve fotoğraflar cihazda.
  await context.setOffline(false);
  await cutServer(context);
  await page.goto(`/lists/${listId}`);
  await expect(tid(page, 'offline-banner')).toBeVisible();
  const again = tid(page, 'place-item').filter({ hasText: 'Gelateria' });
  await expect(again.getByTestId('pending-badge')).toBeVisible();
  await expectLoadedImages(again.getByTestId('place-item-photos'), 1);

  // Bağlantı gelir: önce fotoğraflar yüklenir, sonra öğe ve yorum gönderilir.
  await restoreServer(context);
  await context.setOffline(true);
  await context.setOffline(false);
  await expect(tid(page, 'pending-badge')).toHaveCount(0, { timeout: 20_000 });
  const api = await apiAs(page);
  await expect.poll(async () => {
    const l = await (await api.get(`/lists/${listId}`)).json();
    return l.items[0].details?.photos ?? [];
  }).toEqual([expect.stringMatching(/^[0-9a-f]{32}$/)]);
  const comments = await (await api.get(`/places/${placeId}/comments`)).json();
  const sent = comments.find((x: { body: string }) => x.body === 'Fotoğraflı çevrimdışı yorum');
  expect(sent.photos).toEqual([expect.stringMatching(/^[0-9a-f]{32}$/)]);
  // Liste artık sunucudaki medya adresini gösterir.
  await expect(tid(page, 'place-item').filter({ hasText: 'Gelateria' }).locator('img[src*="/media/"]')).toHaveCount(1);
  await expect(tid(page, 'sync-failures')).toHaveCount(0);
  await api.dispose();
});

test('AC-OFF-4: görülen fotoğraflar çevrimdışı görünür; arama, Keşfet, haritaya dokunma ve içe aktarma anlaşılır mesajla devre dışı, uygulama çökmez', async ({ page, context }) => {
  await register(page);
  await createList(page, 'Roma', 'Görsel Roma');
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  await sheet.getByTestId('place-name').fill('Fotoğraflı Yer');
  await sheet.getByTestId('place-cat-food').click();
  await choosePhoto(page, sheet.getByTestId('place-photos-add-library'), 2);
  await expect(sheet.getByTestId('place-photos-thumb')).toHaveAttribute('data-status', 'done');
  await sheet.getByTestId('place-add').click();
  const row = tid(page, 'place-item').filter({ hasText: 'Fotoğraflı Yer' });
  await expectLoadedImages(row.getByTestId('place-item-photos'), 1);

  await context.setOffline(true);
  await expect(tid(page, 'offline-banner')).toBeVisible();
  // Ekrandan çıkıp yeniden girince fotoğraf önbellekten gelir.
  await backToLists(page);
  await tid(page, 'list-card').filter({ hasText: 'Görsel Roma' }).click();
  const again = tid(page, 'place-item').filter({ hasText: 'Fotoğraflı Yer' });
  await expect(again.locator('img[src*="/media/"]')).toHaveCount(1);
  await expectLoadedImages(again.getByTestId('place-item-photos'), 1);

  // Harita: arama ve dokunarak yer bulma.
  await tid(page, 'seg-map').click();
  await tid(page, 'place-search-input').fill('pizza');
  await expect(tid(page, 'place-search-offline')).toContainText('Çevrimdışısın');
  await tid(page, 'place-search-clear').click();
  if (!(await tid(page, 'tap-panel').isVisible())) await tid(page, 'tap-open').click();
  await tid(page, 'tap-lat').fill('41.9');
  await tid(page, 'tap-lon').fill('12.49');
  await tid(page, 'tap-search').click();
  await expect(tid(page, 'tap-offline')).toContainText('Çevrimdışısın');

  // Keşfet: son kaydedilen hâl / mesaj, yenileme kapalı.
  await tid(page, 'seg-list').click();
  await backToLists(page);
  await tid(page, 'tab-discover').click();
  await expect(tid(page, 'discover-offline')).toContainText('Çevrimdışısın');
  await expect(tid(page, 'discover-refresh')).toHaveAttribute('aria-disabled', 'true');

  // İçe aktarma.
  await tid(page, 'tab-lists').click();
  await tid(page, 'lists-import').click();
  await expect(tid(page, 'import-offline')).toContainText('içe aktarma için internet bağlantısı gerekli');
  await expect(tid(page, 'import-pick')).toHaveAttribute('aria-disabled', 'true');

  // Arkadaş araması gibi diğer sunucu işlemleri hata mesajı verir, çökmez.
  await tid(page, 'back').click();
  await tid(page, 'tab-profile').click();
  await tid(page, 'profile-friends').click();
  await tid(page, 'user-search').fill('ab');
  await tid(page, 'user-search-submit').click();
  await expect(tid(page, 'error')).toContainText('Çevrimdışısın');
  await context.setOffline(false);
  await expect(tid(page, 'offline-banner')).toHaveCount(0);
});

test('AC-OFF-5: çıkış yapınca ve hesap silinince önbellek ve bekleyen sıra cihazdan silinir', async ({ page, context }) => {
  const acc = await register(page);
  await createList(page, 'Roma', 'Gizli Roma');
  await addPlace(page, 'Kayıtlı Yer', 'food');
  const listId = idFromUrl(page, 'lists');
  await context.setOffline(true);
  await addPlace(page, 'Bekleyen Yer', 'bar');
  let keys = await storageKeys(page);
  expect(keys.some((k) => k.startsWith('voyage.cache.'))).toBe(true);
  expect(keys).toContain('voyage.queue');

  await backToLists(page);
  await tid(page, 'tab-profile').click();
  await tid(page, 'logout').click();
  await expect(page).toHaveURL(/\/login$/);
  keys = await storageKeys(page);
  expect(keys.filter((k) => k.startsWith('voyage.cache.') || k === 'voyage.queue' || k === 'voyage.offline.meta' || k === 'voyage.token')).toEqual([]);

  // Yeniden giriş: bekleyen değişiklik gönderilmez (silindi), önbellekten değil sunucudan gelir.
  await context.setOffline(false);
  await page.getByTestId('login-email').fill(acc.email);
  await page.getByTestId('login-password').fill(acc.password);
  await page.getByTestId('login-submit').click();
  await expect(tid(page, 'list-card').filter({ hasText: 'Gizli Roma' })).toBeVisible();
  await expect(tid(page, 'offline-banner')).toHaveCount(0);
  await tid(page, 'list-card').filter({ hasText: 'Gizli Roma' }).click();
  await expect(tid(page, 'place-item-name')).toHaveText(['Kayıtlı Yer']);
  await expect(tid(page, 'pending-badge')).toHaveCount(0);
  const api = await apiAs(page);
  expect(await listNames(api, listId)).toEqual(['Kayıtlı Yer']);
  await backToLists(page);

  // Hesap silme: önbellek, sıra ve cihazdaki planlar da silinir.
  await tid(page, 'list-card').filter({ hasText: 'Gizli Roma' }).click();
  await tid(page, 'seg-plan').click();
  await tid(page, 'plan-day-1').getByTestId('plan-add-1').click();
  await tid(page, 'plan-day-1').getByTestId('plan-pick').filter({ hasText: 'Kayıtlı Yer' }).click();
  await expect.poll(async () => (await storageKeys(page)).some((k) => k.startsWith('voyage.plan.'))).toBe(true);
  await context.setOffline(true);
  await tid(page, 'seg-list').click();
  await addPlace(page, 'Yine Bekleyen', 'bar');
  await context.setOffline(false);
  await expect(tid(page, 'pending-badge')).toHaveCount(0, { timeout: 20_000 });
  await backToLists(page);
  await tid(page, 'tab-profile').click();
  await tid(page, 'delete-account').click();
  await tid(page, 'delete-confirm').click();
  await expect(page).toHaveURL(/\/login$/);
  keys = await storageKeys(page);
  expect(keys.filter((k) => k.startsWith('voyage.'))).toEqual([]);
  await api.dispose();
});
