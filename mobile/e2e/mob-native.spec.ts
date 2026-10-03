import { expect, test } from '@playwright/test';
import { addPlace, createList, openedUrls, register, stubWindowOpen, tid, uniq, userSession } from './helpers';

test('AC-MOB-10: alt sekmeler Keşfet / Listelerim / Mesajlar (Yakında) / Profil ve tasarım öğeleri', async ({ page }) => {
  await register(page);
  const bar = tid(page, 'tab-bar');
  await expect(bar.getByRole('tab')).toHaveText([/Keşfet/, /Listelerim/, /Mesajlar.*Yakında/, /Profil/]);
  await expect(tid(page, 'tab-lists')).toHaveAttribute('aria-selected', 'true');
  await expect(tid(page, 'tab-messages')).toHaveAttribute('aria-disabled', 'true');

  // Mesajlar devre dışı: dokununca gezinmez
  await tid(page, 'tab-messages').click({ force: true });
  await expect(page).toHaveURL(/\/lists$/);

  await tid(page, 'tab-discover').click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(tid(page, 'tab-discover')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Keşfet' })).toBeVisible();
  await tid(page, 'tab-profile').click();
  await expect(page).toHaveURL(/\/profile$/);
  await tid(page, 'tab-lists').click();
  await expect(page).toHaveURL(/\/lists$/);

  // tasarım: Plus Jakarta Sans, turuncu "+" (koyu simge), yeşil başlıklar
  const heading = page.getByRole('heading', { name: 'Listelerim' });
  expect(await heading.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('PlusJakartaSans_800ExtraBold');
  expect(await page.evaluate(() => document.fonts.check('16px PlusJakartaSans_400Regular'))).toBe(true);
  await expect(tid(page, 'list-new')).toHaveCSS('background-color', 'rgb(242, 140, 40)');
  await expect(tid(page, 'list-new')).toHaveAttribute('aria-label', 'Liste oluştur');
  const box = await tid(page, 'list-new').boundingBox();
  expect(box && box.width >= 44 && box.height >= 44).toBe(true);
});

test('AC-MOB-11: Liste / Harita / Plan sekmeleri; Harita koordinatlı yerleri kategori renk ve simgesiyle gösterir', async ({ page }) => {
  await register(page);
  await createList(page, 'Roma', `Harita ${uniq('m')}`);
  await expect(tid(page, 'seg-list')).toHaveAttribute('aria-selected', 'true');
  await addPlace(page, 'Colosseum', 'historic', 'Sabah erken git', { lat: 41.8902, lon: 12.4922 });
  await addPlace(page, 'Roscioli', 'food', '', { lat: 41.8937, lon: 12.4731 });
  await addPlace(page, 'Konumsuz Bar', 'bar');

  await tid(page, 'seg-map').click();
  await expect(tid(page, 'seg-map')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/tab=map/);
  const pins = tid(page, 'map-pin');
  await expect(pins).toHaveCount(2);
  const col = pins.filter({ hasText: 'Colosseum' });
  await expect(col).toHaveAttribute('data-category', 'historic');
  await expect(col.getByTestId('map-pin-category')).toHaveText('Tarihi');
  await expect(col.getByTestId('map-pin-coords')).toHaveText('41.89020, 12.49220');
  await expect(col.getByTestId('map-pin-marker')).toHaveCSS('background-color', 'rgb(46, 125, 91)');
  await expect(pins.filter({ hasText: 'Roscioli' }).getByTestId('map-pin-marker')).toHaveCSS('background-color', 'rgb(194, 97, 12)');
  await expect(pins.filter({ hasText: 'Konumsuz Bar' })).toHaveCount(0);
  await expect(tid(page, 'map-unlocated')).toContainText('1 yerin konumu yok');

  // kategori filtresi haritada da çalışır
  await tid(page, 'filter-food').click();
  await expect(tid(page, 'map-pin')).toHaveCount(1);
  await tid(page, 'filter-all').click();

  // pine dokununca alt kart, oradan yer sayfası
  await col.click();
  await expect(tid(page, 'map-card-name')).toHaveText('Colosseum');
  await tid(page, 'map-card-open').click();
  await expect(tid(page, 'place-title')).toHaveText('Colosseum');

  await page.goBack();
  await tid(page, 'seg-plan').click();
  await expect(tid(page, 'seg-plan')).toHaveAttribute('aria-selected', 'true');
  await expect(tid(page, 'plan-day-1')).toBeVisible();
  await tid(page, 'seg-list').click();
  await expect(tid(page, 'place-item')).toHaveCount(3);
});

test('AC-MOB-12: Plan — günlere atama, gün içinde sıralama, "Sırala" en yakın komşu (otelden), kuş uçuşu mesafe, cihazda saklama', async ({ page }) => {
  await register(page);
  await createList(page, 'İstanbul', `Plan ${uniq('p')}`);
  // Ekleme sırası karışık; otel 41.00 enleminde, diğerleri kuzeyde 0.05 / 0.03 / 0.01 derece uzakta.
  await addPlace(page, 'Uzak Kafe', 'coffee', '', { lat: 41.05, lon: 29.0 });
  await addPlace(page, 'Orta Müze', 'museum', '', { lat: 41.03, lon: 29.0 });
  await addPlace(page, 'Otel Merkez', 'hotel', '', { lat: 41.0, lon: 29.0 });
  await addPlace(page, 'Yakın Park', 'park', '', { lat: 41.01, lon: 29.0 });
  await addPlace(page, 'Konumsuz Yer', 'other');

  await tid(page, 'seg-plan').click();
  const day1 = tid(page, 'plan-day-1');
  await expect(tid(page, 'plan-summary-1')).toHaveText('Henüz durak yok');
  await day1.getByTestId('plan-add-1').click();
  for (const name of ['Uzak Kafe', 'Orta Müze', 'Otel Merkez', 'Yakın Park']) {
    await day1.getByTestId('plan-pick').filter({ hasText: name }).click();
  }
  await expect(day1.getByTestId('plan-item-name')).toHaveText(['Uzak Kafe', 'Orta Müze', 'Otel Merkez', 'Yakın Park']);
  await expect(day1.getByTestId('plan-item-number')).toHaveText(['1', '2', '3', '4']);
  // 0.02 + 0.03 + 0.01 derece enlem ≈ 6,67 km
  await expect(tid(page, 'plan-summary-1')).toHaveText('4 durak · 6,7 km · kuş uçuşu');

  // Sırala: otelden başlayıp en yakın komşu
  await tid(page, 'plan-sort-1').click();
  await expect(day1.getByTestId('plan-item-name')).toHaveText(['Otel Merkez', 'Yakın Park', 'Orta Müze', 'Uzak Kafe']);
  await expect(tid(page, 'plan-summary-1')).toHaveText('4 durak · 5,6 km · kuş uçuşu');

  // gün içinde elle sıralama
  await day1.getByTestId('plan-item').filter({ hasText: 'Uzak Kafe' }).getByTestId('plan-up').click();
  await expect(day1.getByTestId('plan-item-name')).toHaveText(['Otel Merkez', 'Yakın Park', 'Uzak Kafe', 'Orta Müze']);

  // ikinci güne konumsuz yer
  const day2 = tid(page, 'plan-day-2');
  await day2.getByTestId('plan-add-2').click();
  await day2.getByTestId('plan-pick').filter({ hasText: 'Konumsuz Yer' }).click();
  await expect(day2.getByTestId('plan-item-name')).toHaveText(['Konumsuz Yer']);
  await expect(tid(page, 'plan-unplanned')).toContainText('0 yer');

  // cihazda saklanır: yenileyince aynı plan
  await page.reload();
  await expect(tid(page, 'seg-plan')).toHaveAttribute('aria-selected', 'true');
  await expect(tid(page, 'plan-day-1').getByTestId('plan-item-name')).toHaveText(['Otel Merkez', 'Yakın Park', 'Uzak Kafe', 'Orta Müze']);
  await expect(tid(page, 'plan-day-2').getByTestId('plan-item-name')).toHaveText(['Konumsuz Yer']);

  // günün rotası (DayMap): numaralı duraklar, Sırala
  await tid(page, 'plan-daymap-1').click();
  await expect(page).toHaveURL(/\/day\/1$/);
  await expect(tid(page, 'day-title')).toHaveText('Gün 1');
  await expect(tid(page, 'day-stop-name')).toHaveText(['Otel Merkez', 'Yakın Park', 'Uzak Kafe', 'Orta Müze']);
  await expect(tid(page, 'route-stop')).toHaveCount(4);
  await tid(page, 'day-sort').click();
  await expect(tid(page, 'day-stop-name')).toHaveText(['Otel Merkez', 'Yakın Park', 'Orta Müze', 'Uzak Kafe']);
  await expect(tid(page, 'day-summary')).toHaveText('4 durak · 5,6 km · kuş uçuşu');
  await tid(page, 'back').click();
  await expect(tid(page, 'plan-day-1').getByTestId('plan-item-name')).toHaveText(['Otel Merkez', 'Yakın Park', 'Orta Müze', 'Uzak Kafe']);

  // gün sayısı
  await expect(tid(page, 'plan-day-count')).toHaveText('Gün sayısı: 3');
  await tid(page, 'plan-days-inc').click();
  await expect(tid(page, 'plan-day-4')).toBeVisible();
});

test('AC-MOB-13: "Google Maps\'te aç" yeri adıyla (ad, şehir) açar; koordinat kullanılmaz', async ({ page }) => {
  await stubWindowOpen(page);
  await register(page);
  await createList(page, 'İstanbul', `Maps ${uniq('g')}`);
  await addPlace(page, 'Galata Kulesi', 'historic', '', { lat: 41.0256, lon: 28.9741 });
  await addPlace(page, 'Çiya Sofrası & Co', 'food');

  await tid(page, 'place-item').filter({ hasText: 'Galata Kulesi' }).getByTestId('place-maps').click();
  await tid(page, 'place-item').filter({ hasText: 'Çiya Sofrası' }).getByTestId('place-maps').click();
  const byName = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  await expect.poll(() => openedUrls(page)).toEqual([
    byName('Galata Kulesi, İstanbul'),
    byName('Çiya Sofrası & Co, İstanbul'),
  ]);

  // erişilebilir etiket (simge düğmesi)
  await expect(tid(page, 'place-item').filter({ hasText: 'Galata Kulesi' }).getByTestId('place-maps')).toHaveAttribute('aria-label', /Google Maps'te aç/);

  // yer sayfası ve harita kartından da
  await tid(page, 'place-link').filter({ hasText: 'Galata Kulesi' }).click();
  await tid(page, 'place-maps').click();
  await page.goBack();
  await tid(page, 'seg-map').click();
  await tid(page, 'map-pin').filter({ hasText: 'Galata Kulesi' }).click();
  await tid(page, 'map-card-maps').click();
  await expect.poll(async () => (await openedUrls(page)).slice(-2)).toEqual([
    byName('Galata Kulesi, İstanbul'),
    byName('Galata Kulesi, İstanbul'),
  ]);
});

test('AC-MOB-14: yer eklerken konum haritadan ya da cihaz konumuyla seçilir; konumsuz da eklenir', async ({ browser }) => {
  const { ctx, page } = await userSession(browser, 'geo', {
    geolocation: { latitude: 38.4237, longitude: 27.1428 },
    permissions: ['geolocation'],
  });
  await createList(page, 'İzmir', `Konum ${uniq('k')}`);

  // cihaz konumu ("Konumumu kullan")
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  await sheet.getByTestId('place-name').fill('Saat Kulesi');
  await sheet.getByTestId('place-cat-historic').click();
  await sheet.getByTestId('place-use-location').click();
  await expect(sheet.getByTestId('place-coords')).toHaveText('Seçilen konum: 38.42370, 27.14280');
  await sheet.getByTestId('place-add').click();
  await expect(tid(page, 'place-item').filter({ hasText: 'Saat Kulesi' })).toBeVisible();

  // haritadan seçim (web'de koordinat girişi)
  await addPlace(page, 'Kordon', 'park', 'gün batımı', { lat: 38.4380, lon: 27.1420 });

  // konumsuz
  await addPlace(page, 'Boyoz Fırını', 'food');
  // konum seçip vazgeçince ("Konumsuz") konum gönderilmez
  await tid(page, 'place-add-open').click();
  await sheet.getByTestId('place-name').fill('Vazgeçilen Konum');
  await sheet.getByTestId('loc-map').click();
  await sheet.getByTestId('pick-lat').fill('38.5');
  await sheet.getByTestId('pick-lon').fill('27.2');
  await sheet.getByTestId('loc-none').click();
  await expect(sheet.getByTestId('place-coords')).toHaveCount(0);
  await sheet.getByTestId('place-add').click();
  await expect(tid(page, 'place-item').filter({ hasText: 'Vazgeçilen Konum' })).toBeVisible();

  await expect(tid(page, 'place-item')).toHaveCount(4);
  await tid(page, 'seg-map').click();
  await expect(tid(page, 'map-pin')).toHaveCount(2);
  await expect(tid(page, 'map-pin').filter({ hasText: 'Saat Kulesi' }).getByTestId('map-pin-coords')).toHaveText('38.42370, 27.14280');
  await expect(tid(page, 'map-pin').filter({ hasText: 'Kordon' }).getByTestId('map-pin-coords')).toHaveText('38.43800, 27.14200');
  await expect(tid(page, 'map-unlocated')).toContainText('2 yerin konumu yok');

  // sunucuda saklandı: yenileyince aynı
  await page.reload();
  await expect(tid(page, 'map-pin')).toHaveCount(2);
  await ctx.close();
});
