import { expect, test, type Page } from '@playwright/test';
import { addPlace, createList, openedUrls, register, stubWindowOpen, tid, uniq, userSession } from './helpers';

// The API runs with SEARCH_PROVIDER=fake (fixed places in Roma, İstanbul, …; "__fail__" makes it fail with 502).

type PutItem = { provider: string; providerId: string; name: string; lat?: number; lon?: number; category?: string; note?: string };

/** Resolves with the items of the next PUT /lists/:id/items request. */
function nextPut(page: Page): Promise<PutItem[]> {
  return page
    .waitForRequest((r) => r.method() === 'PUT' && /\/lists\/\d+\/items$/.test(r.url()))
    .then((r) => (JSON.parse(r.postData() ?? '{}') as { items: PutItem[] }).items);
}

test('AC-MOB-15: harita sekmesinde arama çubuğu; öneri listesi, yer seçilince geçici pin ve alt kart', async ({ page }) => {
  await stubWindowOpen(page);
  await register(page);
  await createList(page, 'Roma', `Arama ${uniq('s')}`);
  // Konumlu bir yer: harita merkezi Roma olur, arama sonuçları buna göre sıralanır.
  await addPlace(page, 'Pantheon', 'historic', '', { lat: 41.8986, lon: 12.4769 });
  await tid(page, 'seg-map').click();

  // Google Maps benzeri arama çubuğu: haritanın üstünde, tasarım fontu
  const input = tid(page, 'place-search-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('placeholder', /Yer ara/);
  expect(await input.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('PlusJakartaSans');
  const barBox = await input.boundingBox();
  const mapBox = await tid(page, 'places-map').boundingBox();
  expect(barBox && mapBox && barBox.y - mapBox.y < 40).toBe(true);

  // tek karakterde arama yok; yazdıkça (bekleme ile) öneriler açılır, yakın olan önce, mesafeyle
  await input.pressSequentially('h', { delay: 30 });
  await page.waitForTimeout(600);
  await expect(tid(page, 'place-search-results')).toHaveCount(0);
  await input.pressSequentially('ilton', { delay: 30 });
  const results = tid(page, 'place-search-result');
  await expect(results).toHaveCount(2);
  await expect(tid(page, 'place-search-result-name')).toHaveText(['Hilton Rome Airport', 'Hilton İstanbul Bomonti']);
  await expect(results.first()).toHaveAttribute('data-category', 'hotel');
  await expect(results.first().getByTestId('category-icon')).toHaveCSS('background-color', 'rgb(234, 232, 247)');
  await expect(results.first().getByTestId('place-search-result-distance')).toHaveText(/^\d+,\d km$/);
  await expect(results.first().getByTestId('place-search-result-address')).toContainText('Fiumicino');

  // sonuç yok / sağlayıcı hatası
  await input.fill('zzqqxx');
  await expect(tid(page, 'place-search-empty')).toHaveText(/Sonuç yok/);
  await input.fill('__fail__');
  await expect(tid(page, 'place-search-error')).toContainText('Arama şu an yapılamıyor');

  // seçince: liste kapanır, geçici pin ve alt kart (ad, adres, kategori, Listeye ekle, Google Maps'te aç)
  await input.fill('colos');
  await tid(page, 'place-search-result').filter({ hasText: 'Colosseo' }).click();
  await expect(tid(page, 'place-search-results')).toHaveCount(0);
  await expect(input).toHaveValue('Colosseo');
  await expect(tid(page, 'search-pin')).toHaveCount(1);
  await expect(tid(page, 'search-pin-name')).toHaveText('Colosseo');
  await expect(tid(page, 'search-pin-coords')).toHaveText('41.89020, 12.49220');
  await expect(tid(page, 'map-pin')).toHaveCount(1); // kalıcı pinler değişmez
  await expect(tid(page, 'search-card-name')).toHaveText('Colosseo');
  await expect(tid(page, 'search-card-address')).toHaveText('Piazza del Colosseo 1, Roma, İtalya');
  await expect(tid(page, 'search-card-category')).toHaveText('Tarihi');
  await expect(tid(page, 'search-card-category')).toHaveAttribute('data-category', 'historic');
  const add = tid(page, 'search-card-add');
  await expect(add).toHaveText(/Listeye ekle/);
  await expect(add).toHaveCSS('background-color', 'rgb(242, 140, 40)');
  await tid(page, 'search-card-maps').click();
  await expect.poll(() => openedUrls(page)).toEqual(['https://www.google.com/maps/search/?api=1&query=41.8902,12.4922']);

  // kalıcı pine dokununca arama kartı yerine yer kartı; temizle düğmesi aramayı kapatır
  await tid(page, 'map-pin').filter({ hasText: 'Pantheon' }).click();
  await expect(tid(page, 'search-card')).toHaveCount(0);
  await expect(tid(page, 'search-pin')).toHaveCount(0);
  await expect(tid(page, 'map-card-name')).toHaveText('Pantheon');
  await input.fill('galata');
  await tid(page, 'place-search-result').first().click();
  await expect(tid(page, 'search-card-name')).toHaveText('Galata Kulesi');
  await expect(tid(page, 'map-card')).toHaveCount(0);
  await tid(page, 'place-search-clear').click();
  await expect(input).toHaveValue('');
  await expect(tid(page, 'search-card')).toHaveCount(0);
  await expect(tid(page, 'search-pin')).toHaveCount(0);
});

test('AC-MOB-16: "Listeye ekle" pencereyi dolu açar; kaydedilen yer sağlayıcı kimliğini korur ve kalıcı pin olur', async ({ page }) => {
  await register(page);
  await createList(page, 'Roma', `Ekle ${uniq('a')}`);
  await tid(page, 'seg-map').click();
  await expect(tid(page, 'map-empty')).toBeVisible();

  await tid(page, 'place-search-input').pressSequentially('colosseo', { delay: 20 });
  await tid(page, 'place-search-result').filter({ hasText: 'Colosseo' }).click();
  await tid(page, 'search-card-add').click();

  const sheet = page.getByTestId('add-place-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('place-name')).toHaveValue('Colosseo');
  await expect(sheet.getByTestId('place-cat-historic')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('place-coords')).toHaveText('Seçilen konum: 41.89020, 12.49220');
  await expect(sheet.getByTestId('place-picked-address')).toHaveText('Piazza del Colosseo 1, Roma, İtalya');
  await expect(sheet.getByTestId('place-suggest-results')).toHaveCount(0);
  // kullanıcı kategoriyi ve notu yine değiştirebilir
  await sheet.getByTestId('place-cat-museum').click();
  await sheet.getByTestId('place-cat-historic').click();
  await sheet.getByTestId('place-note').fill('Gün doğumunda');
  const put1 = nextPut(page);
  await sheet.getByTestId('place-add').click();
  expect(await put1).toEqual([{
    provider: 'fake', providerId: 'fake-colosseo', name: 'Colosseo', lat: 41.8902, lon: 12.4922,
    category: 'historic', city: 'Roma', note: 'Gün doğumunda',
  }]);
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);

  // geçici pin ve kart kalkar, yer kalıcı pin olur
  await expect(tid(page, 'search-card')).toHaveCount(0);
  await expect(tid(page, 'search-pin')).toHaveCount(0);
  const pin = tid(page, 'map-pin').filter({ hasText: 'Colosseo' });
  await expect(pin).toHaveCount(1);
  await expect(pin).toHaveAttribute('data-category', 'historic');
  await expect(pin.getByTestId('map-pin-coords')).toHaveText('41.89020, 12.49220');

  // aynı sonuç tekrar seçilirse "Listede var"
  await tid(page, 'place-search-input').fill('colosseo');
  await tid(page, 'place-search-result').first().click();
  await expect(tid(page, 'search-card-add')).toHaveText(/Listede var/);
  await expect(tid(page, 'search-card-add')).toHaveAttribute('aria-disabled', 'true');
  await tid(page, 'search-card-close').click();

  // başka bir yer eklenince (liste komple yeniden yazılır) Colosseo kimliğini korur
  await tid(page, 'seg-list').click();
  const put2 = nextPut(page);
  await addPlace(page, 'Elle Eklenen Trattoria', 'food');
  const items = await put2;
  expect(items[0]).toMatchObject({ provider: 'fake', providerId: 'fake-colosseo', name: 'Colosseo', note: 'Gün doğumunda' });
  expect(items[1]).toMatchObject({ provider: 'voyage', name: 'Elle Eklenen Trattoria', category: 'food' });

  // yenileyince sunucudan aynı
  await page.reload();
  await expect(tid(page, 'place-item')).toHaveCount(2);
  await tid(page, 'seg-map').click();
  await expect(tid(page, 'map-pin').filter({ hasText: 'Colosseo' })).toHaveCount(1);
});

test('AC-MOB-17: yer ekleme penceresinde ad alanı öneri gösterir; sonuç yoksa ya da hata olursa elle eklenir', async ({ page }) => {
  await register(page);
  await createList(page, 'İstanbul', `Öneri ${uniq('o')}`);
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  const name = sheet.getByTestId('place-name');

  // öneri seçilince ad, kategori ve konum dolar
  await name.pressSequentially('ayasof', { delay: 30 });
  const sugg = sheet.getByTestId('place-suggest-result');
  await expect(sugg).toHaveCount(1);
  await expect(sugg.getByTestId('place-suggest-result-name')).toHaveText('Ayasofya');
  await expect(sugg.getByTestId('place-suggest-result-address')).toContainText('İstanbul');
  await sugg.click();
  await expect(sheet.getByTestId('place-suggest-results')).toHaveCount(0);
  await expect(name).toHaveValue('Ayasofya');
  await expect(sheet.getByTestId('place-cat-historic')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('place-coords')).toHaveText('Seçilen konum: 41.00860, 28.98020');
  // haritadan seçim ve cihaz konumu ikincil seçenek olarak durur
  await expect(sheet.getByTestId('loc-map')).toBeVisible();
  await expect(sheet.getByTestId('place-use-location')).toBeVisible();
  let put = nextPut(page);
  await sheet.getByTestId('place-add').click();
  expect((await put).at(-1)).toMatchObject({ provider: 'fake', providerId: 'fake-ayasofya', name: 'Ayasofya', category: 'historic', lat: 41.0086, lon: 28.9802 });
  await expect(tid(page, 'place-item').filter({ hasText: 'Ayasofya' })).toBeVisible();

  // sonuç yok: elle ekleme sürer
  await tid(page, 'place-add-open').click();
  await name.pressSequentially('Bizim Ev Mutfağı', { delay: 10 });
  await expect(sheet.getByTestId('place-suggest-empty')).toContainText('Sonuç yok');
  await sheet.getByTestId('place-cat-food').click();
  await expect(sheet.getByTestId('place-suggest-empty')).toHaveCount(0); // alan odaktan çıkınca öneriler kapanır
  put = nextPut(page);
  await sheet.getByTestId('place-add').click();
  expect((await put).at(-1)).toMatchObject({ provider: 'voyage', name: 'Bizim Ev Mutfağı', category: 'food' });
  await expect(tid(page, 'place-item').filter({ hasText: 'Bizim Ev Mutfağı' })).toBeVisible();

  // sağlayıcı hatası: uyarı görünür, elle (haritadan konumla) ekleme sürer
  await tid(page, 'place-add-open').click();
  await name.pressSequentially('__fail__', { delay: 10 });
  await expect(sheet.getByTestId('place-suggest-error')).toContainText('Arama şu an yapılamıyor');
  await name.fill('Moda Sahili');
  await sheet.getByTestId('place-cat-park').click();
  await expect(sheet.getByTestId('place-suggest-error')).toHaveCount(0);
  await expect(sheet.getByTestId('place-suggest-empty')).toHaveCount(0);
  await sheet.getByTestId('loc-map').click();
  await sheet.getByTestId('pick-lat').fill('40.9800');
  await sheet.getByTestId('pick-lon').fill('29.0250');
  put = nextPut(page);
  await sheet.getByTestId('place-add').click();
  expect((await put).at(-1)).toMatchObject({ provider: 'voyage', name: 'Moda Sahili', category: 'park', lat: 40.98, lon: 29.025 });
  await expect(tid(page, 'place-item')).toHaveCount(3);
  // önceki arama sonucu kimliğini korur
  await page.reload();
  await tid(page, 'place-add-open').click();
  await name.fill('Kronotrop Test');
  await sheet.getByTestId('place-cat-coffee').click();
  put = nextPut(page);
  await sheet.getByTestId('place-add').click();
  expect((await put)[0]).toMatchObject({ provider: 'fake', providerId: 'fake-ayasofya' });
});

test('AC-MOB-18: arama varsayılan olarak cihaz konumuna göre en yakından sıralanır; liste şehrine geçilebilir', async ({ browser }) => {
  // Kullanıcı İstanbul'da, Roma için liste hazırlıyor (listede henüz yer yok).
  const { ctx, page } = await userSession(browser, 'near', {
    geolocation: { latitude: 41.0369, longitude: 28.9850 },
    permissions: ['geolocation'],
  });
  await createList(page, 'Roma', `Roma ${uniq('r')}`);
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  await expect(sheet.getByTestId('bias-near')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('bias-city')).toHaveText('Roma');

  const name = sheet.getByTestId('place-name');
  await name.click();
  await name.pressSequentially('hilton', { delay: 30 });
  const names = sheet.getByTestId('place-suggest-result-name');
  // Yakınımda: önce İstanbul'daki Hilton
  await expect(names).toHaveText(['Hilton İstanbul Bomonti', 'Hilton Rome Airport']);

  // Liste şehri: önce Roma'daki Hilton
  await sheet.getByTestId('bias-city').click();
  await expect(sheet.getByTestId('bias-city')).toHaveAttribute('aria-checked', 'true');
  await name.fill('');
  await name.pressSequentially('hilton', { delay: 30 });
  await expect(names).toHaveText(['Hilton Rome Airport', 'Hilton İstanbul Bomonti']);
  await ctx.close();
});

test('AC-MOB-20: arama cihaz dilini gönderir; "restaurant la campana" adı Cervecería La Campana olan yeri bulur', async ({ browser }) => {
  const { ctx, page } = await userSession(browser, 'lang', { locale: 'en-US' });
  await createList(page, 'Madrid', `Madrid ${uniq('m')}`);
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  await sheet.getByTestId('bias-city').click();
  const name = sheet.getByTestId('place-name');
  await name.click();
  const req = page.waitForRequest((r) => r.url().includes('/search/places') && r.url().includes('campana'));
  await name.pressSequentially('Restaurant la campana', { delay: 20 });
  expect(new URL((await req).url()).searchParams.get('lang')).toBe('en');
  const first = sheet.getByTestId('place-suggest-result').first();
  await expect(first.getByTestId('place-suggest-result-name')).toHaveText('Cervecería La Campana');
  await expect(first.getByTestId('place-suggest-result-address')).toContainText('Madrid');
  await ctx.close();
});
