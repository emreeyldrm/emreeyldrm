import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { createList, newAccount, register, tid, uniq, userSession } from './helpers';

// Mesajlaşma (docs/ACCEPTANCE.md, AC-MOB-40..42). İki kullanıcı ayrı tarayıcı bağlamlarında; arkadaşlık ve test
// verisi (listeler) doğrudan API ile (kullanıcının kendi token'ı) kurulur. Yoklama: sohbet 3 sn, liste/rozet 15 sn.

const apiUrl = () => test.info().config.metadata.apiUrl as string;
const SHOTS = '/tmp/claude-0/-home-user-emreeyldrm/671a13a2-83f0-51c4-9979-ac3ad8462da8/scratchpad/shots-mobile';
const NEAR_ROSCIOLI = { lat: 41.8936, lon: 12.4732 };

async function apiAs(page: Page): Promise<APIRequestContext> {
  const token = await page.evaluate(() => localStorage.getItem('voyage.token'));
  expect(token).toBeTruthy();
  return request.newContext({ baseURL: apiUrl(), extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}
async function meId(api: APIRequestContext): Promise<number> {
  const res = await api.get('/me');
  expect(res.ok()).toBe(true);
  return (await res.json()).id;
}
async function makeFriends(a: APIRequestContext, b: APIRequestContext): Promise<void> {
  const [ida, idb] = [await meId(a), await meId(b)];
  expect((await a.post(`/follows/${idb}`)).ok()).toBe(true);
  expect((await b.post(`/follows/${ida}`)).ok()).toBe(true);
}
/** API ile liste + yerler; liste kimliği ve yer kimlikleri. */
async function apiList(api: APIRequestContext, title: string, visibility: 'public' | 'private', places: { name: string; category: string }[]) {
  const created = await api.post('/lists', { data: { city: 'Roma', title, visibility } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id;
  const items = places.map((p, i) => ({ provider: 'voyage', providerId: `${uniq('p')}-${i}`, name: p.name, category: p.category, city: 'Roma', lat: 41.9 + i / 100, lon: 12.48 }));
  expect((await api.put(`/lists/${id}/items`, { data: { items } })).ok()).toBe(true);
  const detail = await (await api.get(`/lists/${id}`)).json();
  return { id: id as number, placeIds: detail.items.map((i: { placeId: number }) => i.placeId) as number[] };
}

test('AC-MOB-40/41: sohbet listesi, sekme rozeti, yeni sohbet, baloncuklar, yoklama, okundu ve ekler', async ({ page, browser }) => {
  const a = await register(page, newAccount('msa'));
  const b = await userSession(browser, 'msb');
  const [apiA, apiB] = [await apiAs(page), await apiAs(b.page)];
  await makeFriends(apiA, apiB);
  const pub = await apiList(apiA, `Yeme-içme ${uniq('t')}`, 'public', [{ name: 'Da Enzo', category: 'food' }, { name: 'Roscioli', category: 'food' }]);
  const priv = await apiList(apiA, `Gizli rota ${uniq('t')}`, 'private', [{ name: 'Gizli bar', category: 'bar' }]);

  // A: Mesajlar sekmesi etkin; sohbet yok; "+" arkadaşlar arasından yeni sohbet açar.
  await tid(page, 'tab-messages').click();
  await expect(page).toHaveURL(/\/messages$/);
  await expect(tid(page, 'conversations-empty')).toBeVisible();
  await tid(page, 'chat-new').click();
  const picker = page.getByTestId('new-chat-sheet');
  await expect(picker.getByTestId('friend-option')).toHaveCount(1);
  await expect(picker.getByTestId('friend-option')).toContainText(`@${b.acc.handle}`);
  await picker.getByTestId('friend-option').click();
  await expect(page).toHaveURL(/\/chat\/\d+$/);
  const chatPath = new URL(page.url()).pathname;
  await expect(tid(page, 'chat-header-handle')).toHaveText(`@${b.acc.handle}`);
  await expect(tid(page, 'chat-empty')).toBeVisible();

  await tid(page, 'chat-input').fill('Roma listeni görebilir miyim?');
  await tid(page, 'chat-send').click();
  const mine = tid(page, 'chat-message').filter({ hasText: 'Roma listeni görebilir miyim?' });
  await expect(mine).toHaveAttribute('data-mine', '1');
  await expect(tid(page, 'chat-input')).toHaveValue('');

  // B: sekme rozetinde 1, listede karşı taraf, son mesaj, saat ve okunmamış rozeti.
  await b.page.goto('/messages');
  await expect(tid(b.page, 'tab-messages-badge')).toHaveText('1');
  const row = tid(b.page, 'conversation-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('conversation-handle')).toHaveText(`@${a.handle}`);
  await expect(row.getByTestId('conversation-preview')).toHaveText('Roma listeni görebilir miyim?');
  await expect(row.getByTestId('conversation-time')).toHaveText(/^\d\d:\d\d$/);
  await expect(row.getByTestId('conversation-unread')).toHaveText('1');

  // B sohbeti açar: okundu işaretlenir, rozet kaybolur; karşı tarafın baloncuğu solda.
  await row.click();
  await expect(b.page).toHaveURL(new RegExp(`${chatPath}$`));
  await expect(tid(b.page, 'chat-message').filter({ hasText: 'Roma listeni' })).toHaveAttribute('data-mine', '0');
  await expect(tid(b.page, 'tab-messages-badge')).toHaveCount(0);
  await b.page.goto('/messages');
  await expect(tid(b.page, 'conversation-unread')).toHaveCount(0);
  await tid(b.page, 'conversation-row').click();

  // Açık sohbet birkaç saniyede bir yenilenir (sayfa yenilemeden).
  await tid(b.page, 'chat-input').fill('Tabii, gönder bakalım.');
  await tid(b.page, 'chat-send').click();
  await expect(tid(page, 'chat-message').filter({ hasText: 'Tabii, gönder bakalım.' })).toHaveAttribute('data-mine', '0', { timeout: 15_000 });

  // A, "📍" ile kendi listesini ekler; B'de kart olarak görünür ve dokununca liste açılır.
  await tid(page, 'chat-attach').click();
  await page.getByTestId('chat-attach-sheet').getByTestId('chat-attach-list').filter({ hasText: 'Yeme-içme' }).click();
  await expect(tid(page, 'chat-attachment').filter({ hasText: 'Yeme-içme' })).toBeVisible();
  const listCard = tid(b.page, 'chat-attachment').filter({ hasText: 'Yeme-içme' });
  await expect(listCard).toBeVisible({ timeout: 15_000 });
  await expect(listCard.getByTestId('chat-attachment-subtitle')).toHaveText('Roma · 2 yer');
  await expect(listCard).toHaveAttribute('data-type', 'list');

  // Gizli liste karşı tarafa yalnızca "Özel liste" olarak görünür; yer eki kategoriyle.
  expect((await apiA.post(`${chatPath.replace('/chat', '/conversations')}/messages`, { data: { attachment: { type: 'list', id: priv.id } } })).status()).toBe(201);
  expect((await apiA.post(`${chatPath.replace('/chat', '/conversations')}/messages`, { data: { body: 'Şuraya mutlaka git', attachment: { type: 'place', id: pub.placeIds[0] } } })).status()).toBe(201);
  const placeCard = tid(b.page, 'chat-attachment').filter({ hasText: 'Da Enzo' });
  await expect(placeCard).toBeVisible({ timeout: 15_000 });
  await expect(placeCard.getByTestId('chat-attachment-subtitle')).toHaveText('Yemek · Roma');
  await expect(tid(b.page, 'chat-bubble-text').filter({ hasText: 'Şuraya mutlaka git' })).toBeVisible();
  await expect(tid(b.page, 'chat-attachment').filter({ hasText: 'Özel liste' })).toBeVisible();
  await expect(b.page.getByText('Gizli rota')).toHaveCount(0);

  // Ekler doğru ekranı açar.
  await placeCard.click();
  await expect(b.page).toHaveURL(new RegExp(`/places/${pub.placeIds[0]}$`));
  await expect(tid(b.page, 'place-title')).toHaveText('Da Enzo');
  await b.page.goBack();
  await tid(b.page, 'chat-attachment').filter({ hasText: 'Yeme-içme' }).click();
  await expect(b.page).toHaveURL(new RegExp(`/lists/${pub.id}$`));
  await expect(tid(b.page, 'list-detail-title')).toContainText('Yeme-içme');

  // A'nın listesinde son mesaj ve B'den okunmamış yok (kendi mesajları sayılmaz) — A sohbetteyken okundu.
  await page.goto('/messages');
  await expect(tid(page, 'conversation-preview')).toHaveText('Sen: Şuraya mutlaka git');
  await expect(tid(page, 'tab-messages-badge')).toHaveCount(0);

  // Çevrimdışı: son görülen liste görünür, yeni sohbet/gönderim kapalı ve mesajı gösterilir.
  await page.context().setOffline(true);
  await expect(tid(page, 'offline-banner')).toBeVisible();
  await expect(tid(page, 'conversation-row')).toHaveCount(1);
  await expect(tid(page, 'chat-offline')).toContainText('Çevrimdışısın');
  await tid(page, 'conversation-row').click();
  await expect(tid(page, 'chat-message').filter({ hasText: 'Roma listeni' })).toBeVisible();
  await expect(tid(page, 'chat-send')).toHaveAttribute('aria-disabled', 'true');
  await page.context().setOffline(false);
  await b.ctx.close();
});

test('AC-MOB-42: yer sayfasından ve yer kartından "Mesajla gönder"', async ({ page, browser }) => {
  await register(page, newAccount('msc'));
  const friend = await userSession(browser, 'msd');
  const [apiC, apiD] = [await apiAs(page), await apiAs(friend.page)];
  await makeFriends(apiC, apiD);
  const pub = await apiList(apiC, `Plajlar ${uniq('t')}`, 'public', [{ name: 'Praia do Carvalho', category: 'beach' }]);

  // Yer sayfası: arkadaş seçici (yalnızca arkadaşlar), not, gönder → "Sohbete git".
  await page.goto(`/places/${pub.placeIds[0]}`);
  await expect(tid(page, 'place-title')).toHaveText('Praia do Carvalho');
  await tid(page, 'send-to-friend').click();
  const sheet = page.getByTestId('send-sheet');
  await expect(sheet).toContainText('Yeri mesajla gönder');
  await sheet.getByTestId('send-note').fill('Lizbon\'da buraya git!');
  await sheet.getByTestId('friend-option').filter({ hasText: `@${friend.acc.handle}` }).click();
  await expect(sheet.getByTestId('send-done')).toContainText(`@${friend.acc.handle} kişisine gönderildi.`);
  await sheet.getByTestId('send-open-chat').click();
  await expect(page).toHaveURL(/\/chat\/\d+$/);
  const card = tid(page, 'chat-attachment').filter({ hasText: 'Praia do Carvalho' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('chat-attachment-subtitle')).toHaveText('Plaj · Roma');
  await expect(tid(page, 'chat-bubble-text').filter({ hasText: 'Lizbon\'da buraya git!' })).toBeVisible();

  // Karşı taraf: bildirim yerine rozet (yoklama) ve kart; dokununca yer sayfası.
  await friend.page.goto('/messages');
  await expect(tid(friend.page, 'tab-messages-badge')).toHaveText('1');
  await expect(tid(friend.page, 'conversation-preview')).toHaveText('Lizbon\'da buraya git!');
  await tid(friend.page, 'conversation-row').click();
  await tid(friend.page, 'chat-input').fill('Harika, kaydettim. Benim Roma listemi de atayım.');
  await tid(friend.page, 'chat-send').click();
  await expect(tid(page, 'chat-bubble-text').filter({ hasText: 'Benim Roma listemi' })).toBeVisible({ timeout: 15_000 });
  await tid(friend.page, 'chat-attachment').filter({ hasText: 'Praia do Carvalho' }).click();
  await expect(friend.page).toHaveURL(new RegExp(`/places/${pub.placeIds[0]}$`));

  // Ekran görüntüsü: yer ekli sohbet (390×844).
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, '13-mesajlar.png') });

  // Haritadaki yer kartı (PlacePreviewCard) da gönderebilir.
  await createList(page, 'Roma', `Harita ${uniq('m')}`);
  await tid(page, 'seg-map').click();
  if (!(await tid(page, 'tap-panel').isVisible())) await tid(page, 'tap-open').click();
  await tid(page, 'tap-lat').fill(String(NEAR_ROSCIOLI.lat));
  await tid(page, 'tap-lon').fill(String(NEAR_ROSCIOLI.lon));
  await tid(page, 'tap-search').click();
  await expect(tid(page, 'search-card-name')).toHaveText('Roscioli Salumeria');
  await tid(page, 'search-card-send').click();
  await page.getByTestId('send-sheet').getByTestId('friend-option').click();
  await expect(page.getByTestId('send-sheet').getByTestId('send-done')).toBeVisible();
  await friend.page.goto('/messages');
  await expect(tid(friend.page, 'conversation-preview')).toHaveText('Bir yer gönderdi');
  await tid(friend.page, 'conversation-row').click();
  await expect(tid(friend.page, 'chat-attachment').filter({ hasText: 'Roscioli Salumeria' })).toBeVisible();

  // Liste paylaşım ekranındaki "Mesajla gönder" listeyi gönderir; arkadaş kartı açınca listeye gider.
  await page.goto(`/lists/${pub.id}/share`);
  await tid(page, 'share-message').click();
  await page.getByTestId('send-sheet').getByTestId('friend-option').filter({ hasText: `@${friend.acc.handle}` }).click();
  await expect(page.getByTestId('send-sheet').getByTestId('send-done')).toBeVisible();
  await friend.page.goto('/messages');
  await tid(friend.page, 'conversation-row').click();
  const listCard = tid(friend.page, 'chat-attachment').filter({ hasText: 'Plajlar' });
  await expect(listCard).toBeVisible({ timeout: 15_000 });
  await listCard.click();
  await expect(friend.page).toHaveURL(new RegExp(`/lists/${pub.id}$`));
  await friend.ctx.close();
});
