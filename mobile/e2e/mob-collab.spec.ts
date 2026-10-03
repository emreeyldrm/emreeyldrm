import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { addPlace, createList, newAccount, register, tid, uniq, userSession } from './helpers';

// Kopyalama ve ortak liste ekranları (docs/ACCEPTANCE.md, AC-MOB-37..39). Her kullanıcı ayrı tarayıcı bağlamında;
// arkadaşlık (karşılıklı takip) ve engel gibi kurulumlar doğrudan API ile (kullanıcının kendi token'ı) yapılır.

const apiUrl = () => test.info().config.metadata.apiUrl as string;
const OFFLINE = /Çevrimdışısın/;

async function apiAs(page: Page): Promise<APIRequestContext> {
  const token = await page.evaluate(() => localStorage.getItem('voyage.token'));
  expect(token).toBeTruthy();
  return request.newContext({ baseURL: apiUrl(), extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}
async function meId(api: APIRequestContext): Promise<number | string> {
  const res = await api.get('/me');
  expect(res.ok()).toBe(true);
  return (await res.json()).id;
}
async function makeFriends(a: APIRequestContext, b: APIRequestContext): Promise<void> {
  const [ida, idb] = [await meId(a), await meId(b)];
  expect((await a.post(`/follows/${idb}`)).ok()).toBe(true);
  expect((await b.post(`/follows/${ida}`)).ok()).toBe(true);
}
const listIdFromUrl = (page: Page) => /\/lists\/(\d+)/.exec(page.url())![1];

test('AC-MOB-38: "Birlikte düzenle" — arkadaş önerileri, üye ekleme/çıkarma, hata mesajları, çevrimdışı mesajı', async ({ page, browser, context }) => {
  const owner = await register(page, newAccount('own'));
  const friend = await userSession(browser, 'frn');
  const stranger = await userSession(browser, 'str');
  const oneWay = await userSession(browser, 'one');
  const [apiO, apiF, apiS, apiW] = [await apiAs(page), await apiAs(friend.page), await apiAs(stranger.page), await apiAs(oneWay.page)];
  await makeFriends(apiO, apiF);
  expect((await apiO.post(`/follows/${await meId(apiW)}`)).ok()).toBe(true); // tek yönlü: arkadaş değil

  const title = `Ortak ${uniq('t')}`;
  await createList(page, 'Roma', title);
  await addPlace(page, 'Kolezyum', 'historic');
  const listId = listIdFromUrl(page);
  await expect(tid(page, 'list-detail-members')).toHaveCount(0);

  await tid(page, 'list-share').click();
  await expect(page).toHaveURL(/\/share$/);
  const section = tid(page, 'collab-section');
  await expect(section).toContainText('Birlikte düzenle');
  await expect(section.getByTestId('member-owner')).toContainText(`@${owner.handle}`);
  await expect(section.getByTestId('member-owner')).toContainText('Sahip');
  await expect(section.getByTestId('members-empty')).toBeVisible();
  await expect(section.getByTestId('member-count')).toHaveText('0/20 üye');

  // Yalnızca karşılıklı takip edilenler önerilir.
  const suggestions = section.getByTestId('friend-suggestion');
  await expect(suggestions).toHaveCount(1);
  await expect(suggestions).toContainText(`@${friend.acc.handle}`);
  await section.getByTestId('member-search').fill(oneWay.acc.handle);
  await expect(section.getByTestId('friend-suggestions-empty')).toBeVisible();

  // Hata mesajları: arkadaş değil (403), olmayan kullanıcı (404), engel (403).
  await section.getByTestId('member-add').click();
  await expect(tid(page, 'error')).toHaveText(`@${oneWay.acc.handle} arkadaşın değil. Yalnızca karşılıklı takipleştiğin kişileri ekleyebilirsin.`);
  await section.getByTestId('member-search').fill('yok_boyle_biri_x');
  await section.getByTestId('member-add').click();
  await expect(tid(page, 'error')).toHaveText('@yok_boyle_biri_x adında bir kullanıcı bulunamadı.');
  await makeFriends(apiO, apiS);
  expect((await apiS.post(`/blocks/${await meId(apiO)}`)).ok()).toBe(true);
  await section.getByTestId('member-search').fill(stranger.acc.handle);
  await section.getByTestId('member-add').click();
  await expect(tid(page, 'error')).toHaveText(`@${stranger.acc.handle} eklenemez: aranızda engelleme var.`);

  // Çevrimdışıyken üye yönetimi yapılmaz (sıraya da alınmaz).
  await section.getByTestId('member-search').fill(friend.acc.handle);
  await context.setOffline(true);
  await expect(section.getByTestId('member-offline')).toBeVisible();
  await section.getByTestId('member-add').click();
  await expect(tid(page, 'error')).toHaveText(OFFLINE);
  await context.setOffline(false);
  await expect(section.getByTestId('member-offline')).toHaveCount(0);
  expect(await (await apiO.get(`/lists/${listId}/members`)).json()).toEqual([]);

  // Öneriden ekleme.
  await section.getByTestId('member-search').fill(friend.acc.handle.slice(0, 4));
  await suggestions.filter({ hasText: `@${friend.acc.handle}` }).getByTestId('friend-add').click();
  await expect(tid(page, 'info')).toContainText(`@${friend.acc.handle} artık bu listeyi`);
  await expect(section.getByTestId('member-row')).toHaveCount(1);
  await expect(section.getByTestId('member-row')).toContainText(`@${friend.acc.handle}`);
  await expect(section.getByTestId('member-count')).toHaveText('1/20 üye');
  await expect(section.getByTestId('member-search')).toHaveValue('');
  await expect(section.getByTestId('friend-suggestion')).toHaveCount(0); // üye artık önerilmez
  await expect(tid(page, 'visibility-private')).toContainText('Sen ve listenin üyeleri');

  // Liste başlığında üye sayısı.
  await tid(page, 'share-done').click();
  await expect(tid(page, 'list-detail-members')).toHaveText('1 üye');

  // Sahip üyeyi çıkarır (onaylı); üye listeye erişemez.
  await tid(page, 'list-share').click();
  await tid(page, 'collab-section').getByTestId('member-remove').click();
  await expect(tid(page, 'member-remove-dialog')).toContainText(`@${friend.acc.handle}`);
  await tid(page, 'member-remove-confirm').click();
  await expect(tid(page, 'collab-section').getByTestId('member-row')).toHaveCount(0);
  await tid(page, 'share-done').click();
  await expect(tid(page, 'list-detail-members')).toHaveCount(0);
  await friend.page.goto('/lists');
  await expect(tid(friend.page, 'list-card')).toHaveCount(0);

  for (const x of [friend, stranger, oneWay]) await x.ctx.close();
  for (const a of [apiO, apiF, apiS, apiW]) await a.dispose();
});

test('AC-MOB-39: Listelerim\'de "Ortak · @sahip"; düzenleyici yer ekler/düzenler (çevrimdışı sırayla da), sahip denetimlerini görmez, listeden ayrılır', async ({ page, browser }) => {
  const owner = await register(page, newAccount('own'));
  const ed = await userSession(browser, 'edt');
  const [apiO, apiE] = [await apiAs(page), await apiAs(ed.page)];
  await makeFriends(apiO, apiE);
  const title = `Birlikte ${uniq('t')}`;
  await createList(page, 'Roma', title);
  await addPlace(page, 'Kolezyum', 'historic');
  const listId = listIdFromUrl(page);
  await tid(page, 'list-share').click();
  await tid(page, 'collab-section').getByTestId('friend-add').click();
  await expect(tid(page, 'collab-section').getByTestId('member-row')).toContainText(`@${ed.acc.handle}`);
  await tid(page, 'share-done').click();

  // Düzenleyicinin Listelerim'i: ortak liste etiketi.
  const ep = ed.page;
  await ep.goto('/lists');
  const card = tid(ep, 'list-card').filter({ hasText: title });
  await expect(card.getByTestId('list-shared-badge')).toHaveText(`Ortak · @${owner.handle}`);
  await card.click();
  await expect(tid(ep, 'list-detail-title')).toHaveText(title);
  await expect(tid(ep, 'list-detail-members')).toHaveText('1 üye');
  await expect(tid(ep, 'list-detail-shared')).toBeVisible();

  // Sahip denetimleri yok: silme, görünürlük, izinler, üye ekleme/çıkarma; "Listeden ayrıl" var.
  await expect(tid(ep, 'list-delete')).toHaveCount(0);
  await expect(tid(ep, 'list-leave')).toBeVisible();
  await expect(tid(ep, 'list-copy')).toBeVisible(); // allowCopy varsayılan açık: üye de kopyalayabilir

  // Yer ekler ve düzenler; sahip görür.
  await addPlace(ep, 'Pantheon', 'historic', 'gün batımında');
  await tid(ep, 'place-item').filter({ hasText: 'Kolezyum' }).getByTestId('place-edit').click();
  const sheet = ep.getByTestId('add-place-sheet');
  await sheet.getByTestId('place-note').fill('erken git');
  await sheet.getByTestId('place-save').click();
  await expect(tid(ep, 'place-item').filter({ hasText: 'Kolezyum' }).getByTestId('place-item-note')).toHaveText('erken git');
  await page.reload();
  await expect(tid(page, 'place-item-name')).toHaveText(['Kolezyum', 'Pantheon']);
  await expect(tid(page, 'place-item').filter({ hasText: 'Kolezyum' }).getByTestId('place-item-note')).toHaveText('erken git');

  // Çevrimdışıyken düzenleyicinin eklemesi sıraya girer, bağlantı gelince gider.
  await ed.ctx.setOffline(true);
  await expect(tid(ep, 'offline-banner')).toBeVisible();
  await addPlace(ep, 'Trevi', 'historic');
  await expect(tid(ep, 'place-item').filter({ hasText: 'Trevi' }).getByTestId('pending-badge')).toBeVisible();
  await ed.ctx.setOffline(false);
  await expect(tid(ep, 'pending-badge')).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => ((await (await apiO.get(`/lists/${listId}`)).json()).items as { name: string }[]).map((i) => i.name))
    .toEqual(['Kolezyum', 'Pantheon', 'Trevi']);

  // Paylaşım ekranı: üyeler görünür, sahip denetimleri yok.
  await tid(ep, 'list-share').click();
  await expect(ep).toHaveURL(/\/share$/);
  const section = tid(ep, 'collab-section');
  await expect(section.getByTestId('member-owner')).toContainText(`@${owner.handle}`);
  await expect(section.getByTestId('member-row')).toContainText(`@${ed.acc.handle}`);
  await expect(section.getByTestId('member-row')).toContainText('Sen');
  for (const id of ['visibility-toggle', 'visibility-public', 'toggle-allow-copy', 'toggle-allow-comments', 'member-search', 'member-add', 'member-remove', 'friend-suggestions']) {
    await expect(tid(ep, id)).toHaveCount(0);
  }

  // Listeden ayrıl: Listelerim'e döner, liste kaybolur ve özel listeye erişim biter.
  await tid(ep, 'share-leave').click();
  await expect(tid(ep, 'leave-dialog')).toBeVisible();
  await tid(ep, 'leave-confirm').click();
  await expect(ep).toHaveURL(/\/lists$/);
  await expect(tid(ep, 'list-card').filter({ hasText: title })).toHaveCount(0);
  await ep.goto(`/lists/${listId}`);
  await expect(tid(ep, 'error')).toBeVisible();
  await expect(tid(ep, 'place-item')).toHaveCount(0);

  await page.reload();
  await expect(tid(page, 'list-detail-title')).toHaveText(title);
  await expect(tid(page, 'list-detail-members')).toHaveCount(0);
  await ed.ctx.close();
  await apiO.dispose(); await apiE.dispose();
});

test('AC-MOB-37: "Listeyi kopyala" yeni özel listeye götürür; izin yoksa düğme yok; sahibinde "Kopyasını oluştur"; çevrimdışı mesajı', async ({ page, browser }) => {
  await register(page, newAccount('own'));
  await createList(page, 'Roma', 'Roma');
  await addPlace(page, 'Roscioli', 'food', 'carbonara');
  await addPlace(page, 'Pantheon', 'historic');
  const srcId = listIdFromUrl(page);
  await tid(page, 'list-share').click();
  await tid(page, 'visibility-public').click();
  await expect(tid(page, 'visibility-public')).toHaveAttribute('aria-checked', 'true');
  await expect(tid(page, 'toggle-allow-copy')).toHaveAttribute('aria-checked', 'true');
  await tid(page, 'share-done').click();

  const other = await userSession(browser, 'cpy');
  const op = other.page;
  await op.goto(`/lists/${srcId}`);
  await expect(tid(op, 'list-detail-title')).toHaveText('Roma');
  await expect(tid(op, 'place-add-open')).toHaveCount(0); // üye değil: salt okunur
  await expect(tid(op, 'list-share')).toHaveCount(0);
  await expect(tid(op, 'list-leave')).toHaveCount(0);
  await expect(tid(op, 'list-copy')).toHaveText('Listeyi kopyala');

  // Çevrimdışıyken kopyalanmaz, mesaj gösterilir.
  await other.ctx.setOffline(true);
  await tid(op, 'list-copy').click();
  await expect(tid(op, 'error')).toHaveText(OFFLINE);
  await expect(op).toHaveURL(new RegExp(`/lists/${srcId}$`));
  await other.ctx.setOffline(false);
  await expect(tid(op, 'offline-banner')).toHaveCount(0);

  await tid(op, 'list-copy').click();
  await expect(op).not.toHaveURL(new RegExp(`/lists/${srcId}$`));
  await expect(op).toHaveURL(/\/lists\/\d+$/);
  await expect(tid(op, 'list-detail-title')).toHaveText('Roma (kopya)');
  await expect(tid(op, 'list-detail-visibility')).toHaveText('Özel');
  await expect(tid(op, 'place-item-name')).toHaveText(['Roscioli', 'Pantheon']);
  await expect(tid(op, 'place-item').filter({ hasText: 'Roscioli' }).getByTestId('place-item-note')).toHaveText('carbonara');
  await expect(tid(op, 'place-add-open')).toBeVisible(); // kendi listesi
  await expect(tid(op, 'list-copy')).toHaveText('Kopyasını oluştur');
  await op.goto('/lists');
  const copyCard = tid(op, 'list-card').filter({ hasText: 'Roma (kopya)' });
  await expect(copyCard).toBeVisible();
  await expect(copyCard.getByTestId('list-shared-badge')).toHaveCount(0);

  // Sahip kopyalamayı kapatır: başkasında düğme görünmez; sahibinde "Kopyasını oluştur" kalır.
  await tid(page, 'list-share').click();
  await tid(page, 'toggle-allow-copy').click();
  await expect(tid(page, 'toggle-allow-copy')).toHaveAttribute('aria-checked', 'false');
  await tid(page, 'share-done').click();
  await op.goto(`/lists/${srcId}`);
  await expect(tid(op, 'list-detail-title')).toHaveText('Roma');
  await expect(tid(op, 'list-copy')).toHaveCount(0);

  await expect(tid(page, 'list-copy')).toHaveText('Kopyasını oluştur');
  await tid(page, 'list-copy').click();
  await expect(page).not.toHaveURL(new RegExp(`/lists/${srcId}$`));
  await expect(tid(page, 'list-detail-title')).toHaveText('Roma (kopya)');
  await expect(tid(page, 'place-item')).toHaveCount(2);
  await other.ctx.close();
});
