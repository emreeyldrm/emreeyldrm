import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { openedUrls, register, stubWindowOpen, tid, uniq } from './helpers';

// Google listelerini içe aktarma (docs/ACCEPTANCE.md, IMP): AC-MOB-31..36.
// Dosyalar testte üretilir ve web dosya seçicisine (expo-document-picker'ın gizli <input type=file multiple>) verilir.
// API SEARCH_PROVIDER=fake ile çalışır (Roma, İstanbul, Madrid, Milano … fikstürleri; ad/adres alt dize eşleşmesi).

const apiUrl = () => test.info().config.metadata.apiUrl as string;

type FilePayload = { name: string; mimeType: string; buffer: Buffer };
const csvFile = (name: string, text: string): FilePayload => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
const jsonFile = (name: string, data: unknown): FilePayload => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data), 'utf8') });

const ROSCIOLI_URL = 'https://www.google.com/maps/place/Roscioli+Salumeria/data=!4m2!3m1!1s0x132f604f678640a9:0xcad165fa2036ce2c';
const ENZO_URL = 'https://maps.app.goo.gl/TrattoriaYok';

/** Takeout "Kaydedilenler" CSV'si: BOM, CRLF, tırnaklı alanda virgül + yeni satır, boş satır, tekrar eden yer. */
const ROMA_CSV = '﻿' + [
  'Title,Note,URL,Tags,Comment',
  ',,,,',
  `Roscioli Salumeria,"Carbonara, cacio e pepe\nRezervasyon şart",${ROSCIOLI_URL},,`,
  `Trattoria Inesistente,,${ENZO_URL},,`, // eşleşmez -> konumsuz
  'Bar Basso,Negroni sbagliato,https://maps.app.goo.gl/BarBasso,,', // Milano'da: Roma merkezine ~480 km -> "Kontrol et"
  '',
  `Roscioli Salumeria,tekrar,${ROSCIOLI_URL},,`, // aynı yer ikinci kez eklenmez
].join('\r\n') + '\r\n';

/** Küçük harfli başlıklar, yalnızca Title/Note/URL. */
const IST_CSV = ['title,note,url', 'Kronotrop,Filtre kahve,https://maps.app.goo.gl/Kronotrop', '"Çiya Sofrası","Kebap, perde pilavı",'].join('\n');

/** Haritalar (yerleriniz): Saved Places.json (GeoJSON) — Madrid'de koordinatlı ve [0,0] (konumsuz) yer, İstanbul'da bir yer. */
const SAVED_PLACES = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-3.7076, 40.4148] }, properties: {
      date: '2024-03-01T10:00:00Z', google_maps_url: 'http://maps.google.com/?cid=1111111111',
      location: { address: 'Calle Botoneras 6, 28012 Madrid, España', name: 'Cervecería La Campana', country_code: 'ES' } } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {
      google_maps_url: 'https://maps.google.com/?cid=2222222222', Comment: 'Churros',
      location: { address: 'Calle Mayor 10, 28013 Madrid, España', name: 'Café La Campana' } } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [28.9802, 41.0086] }, properties: {
      google_maps_url: 'https://maps.google.com/?cid=3333333333', location: { name: 'Ayasofya', address: 'Sultan Ahmet, Fatih, İstanbul' } } },
  ],
};

async function token(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('voyage.token') ?? '');
}
async function apiFor(page: Page): Promise<APIRequestContext> {
  return request.newContext({ baseURL: apiUrl(), extraHTTPHeaders: { Authorization: `Bearer ${await token(page)}` } });
}

async function openImport(page: Page) {
  await page.goto('/lists');
  await tid(page, 'lists-import').click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(tid(page, 'import-howto')).toBeVisible();
}

async function pickFiles(page: Page, files: FilePayload[], button = 'import-pick') {
  const chooser = page.waitForEvent('filechooser');
  await tid(page, button).click();
  const fc = await chooser;
  expect(fc.isMultiple()).toBe(true);
  await fc.setFiles(files);
}

const fileCard = (page: Page, name: string, nth = 0) => tid(page, 'import-file').filter({ has: page.locator(`[data-testid="import-file-name"]:text-is("${name}")`) }).nth(nth);
const row = (page: Page, name: string) => tid(page, 'import-row').filter({ has: page.locator(`[data-testid="import-row-name"]:text-is("${name}")`) });

async function waitMatched(page: Page) {
  await expect(tid(page, 'import-progress')).toHaveAttribute('data-done', 'true', { timeout: 30_000 });
  await expect(tid(page, 'import-progress')).toHaveAttribute('aria-valuenow', '100');
}

test('AC-MOB-31: Listelerim\'de "Google\'dan içe aktar"; Takeout adımları; birden çok .csv / .json seçilir', async ({ page }) => {
  await stubWindowOpen(page);
  await register(page);
  await expect(tid(page, 'lists-import')).toContainText("Google'dan içe aktar");
  await openImport(page);
  const howto = tid(page, 'import-howto');
  for (const t of ['takeout.google.com', 'Kaydedilenler', 'Haritalar (yerleriniz)', '.zip', 'Saved Places.json', '.csv'])
    await expect(howto).toContainText(t);
  await tid(page, 'import-takeout-link').click();
  expect(await openedUrls(page)).toEqual(['https://takeout.google.com/']);

  // Seçici çoklu seçime izin verir ve yalnızca CSV/JSON'u önerir.
  const chooser = page.waitForEvent('filechooser');
  await tid(page, 'import-pick').click();
  const fc = await chooser;
  expect(fc.isMultiple()).toBe(true);
  expect(await fc.element().getAttribute('accept')).toContain('.csv');
  expect(await fc.element().getAttribute('accept')).toContain('.json');
  await fc.setFiles([csvFile('Roma yemek.csv', ROMA_CSV), jsonFile('Saved Places.json', SAVED_PLACES)]);
  await expect(tid(page, 'import-preview')).toBeVisible();
  // JSON yerleri şehre göre gruplanır: Roma CSV + Madrid + İstanbul
  await expect(tid(page, 'import-file')).toHaveCount(3);

  // "Dosya ekle" ile sonradan bir dosya daha
  await pickFiles(page, [csvFile('İstanbul kahve.csv', IST_CSV)], 'import-pick-more');
  await expect(tid(page, 'import-file')).toHaveCount(4);
  // okunamayan dosya kartta hata gösterir ve aktarılmaz
  await pickFiles(page, [csvFile('bozuk.csv', 'foo,bar\n1,2\n')], 'import-pick-more');
  const bad = fileCard(page, 'bozuk.csv');
  await expect(bad).toContainText('Başlık satırı bulunamadı');
  await expect(bad.getByTestId('import-list-name')).toHaveCount(0);
});

test('AC-MOB-32..35: önizleme, eşleştirme, gözden geçirme ve içe aktarma (yeni + mevcut liste, tekrarlar, notlar, Google URL)', async ({ page }) => {
  test.setTimeout(120_000);
  await stubWindowOpen(page);
  await register(page);
  const api = await apiFor(page);
  // Mevcut liste: aynı ad ("İstanbul kahve"), içinde Kronotrop (arama sağlayıcısı kimliğiyle) zaten var.
  const existing = (await (await api.post('/lists', { data: { city: 'İstanbul', title: 'İstanbul kahve' } })).json()).id as number;
  expect((await api.put(`/lists/${existing}/items`, { data: { items: [
    { provider: 'fake', providerId: 'fake-kronotrop', name: 'Kronotrop', lat: 41.0313, lon: 28.9786, category: 'coffee', note: 'eski not' },
    { provider: 'voyage', providerId: 'galata@istanbul', name: 'Galata', category: 'historic' },
  ] } })).status()).toBe(200);

  await openImport(page);
  await pickFiles(page, [csvFile('Roma yemek.csv', ROMA_CSV), csvFile('İstanbul kahve.csv', IST_CSV), jsonFile('Saved Places.json', SAVED_PLACES)]);

  // AC-MOB-32/33: CSV kartı — liste adı dosya adından, şehir tahmini, tür kelimesinden kategori, yer sayısı (boş/tekrar satırlar)
  const roma = fileCard(page, 'Roma yemek.csv');
  await expect(roma.getByTestId('import-list-name')).toHaveValue('Roma yemek');
  await expect(roma.getByTestId('import-city')).toHaveValue('Roma');
  await expect(roma.getByTestId('import-cat-food')).toHaveAttribute('aria-checked', 'true');
  await expect(roma.getByTestId('import-file-count')).toHaveText('4 yer');
  await expect(roma.getByTestId('import-target-new')).toHaveAttribute('aria-checked', 'true');

  // Aynı adlı mevcut liste varsayılan olarak seçilir; "Otomatik" kategoriye geçilir.
  const ist = fileCard(page, 'İstanbul kahve.csv');
  await expect(ist.getByTestId('import-city')).toHaveValue('İstanbul');
  await expect(ist.getByTestId('import-cat-coffee')).toHaveAttribute('aria-checked', 'true');
  await expect(ist.getByTestId('import-target-existing')).toHaveAttribute('aria-checked', 'true');
  await expect(ist.getByTestId('import-existing-option').filter({ hasText: 'İstanbul kahve' })).toHaveAttribute('aria-checked', 'true');
  await ist.getByTestId('import-cat-auto').click();
  await expect(ist.getByTestId('import-cat-auto')).toHaveAttribute('aria-checked', 'true');

  // JSON: şehir başına kart; Madrid (koordinatlı + adresten), İstanbul (bu testte aktarılmaz)
  const madrid = fileCard(page, 'Saved Places.json', 0);
  await expect(madrid.getByTestId('import-city')).toHaveValue('Madrid');
  await expect(madrid.getByTestId('import-file-count')).toHaveText('2 yer · 1 konumlu');
  await expect(madrid.getByTestId('import-cat-auto')).toHaveAttribute('aria-checked', 'true');
  await madrid.getByTestId('import-list-name').fill('Madrid yıldızlılar');
  // şehir alanı öneri gösterir ve değiştirilebilir
  await madrid.getByTestId('import-city').fill('madri');
  await madrid.getByTestId('city-suggest-item').filter({ hasText: 'Madrid' }).first().click();
  await expect(madrid.getByTestId('import-city')).toHaveValue('Madrid');
  const istJson = fileCard(page, 'Saved Places.json', 1);
  await expect(istJson.getByTestId('import-city')).toHaveValue('İstanbul');
  await istJson.getByTestId('import-include').click();
  await expect(istJson.getByTestId('import-include')).toHaveAttribute('aria-checked', 'false');

  // AC-MOB-34: eşleştirme
  await tid(page, 'import-match-start').click();
  await waitMatched(page);
  await expect(tid(page, 'import-progress-text')).toHaveText('Eşleştirme bitti · 8 yer');

  const rosc = row(page, 'Roscioli Salumeria').first();
  await expect(rosc).toHaveAttribute('data-status', 'ok');
  await expect(rosc.getByTestId('import-row-badge')).toHaveText('Eşleşti');
  await expect(rosc.getByTestId('import-row-match')).toContainText('Roscioli Salumeria · Via dei Giubbonari 21');
  await expect(row(page, 'Trattoria Inesistente').getByTestId('import-row-badge')).toHaveText('Konumsuz');
  await expect(row(page, 'Trattoria Inesistente').getByTestId('import-row-match')).toHaveText('Bulunamadı · konumsuz eklenecek');
  const basso = row(page, 'Bar Basso');
  await expect(basso.getByTestId('import-row-badge')).toHaveText('Kontrol et');
  await expect(basso.getByTestId('import-row-why')).toHaveText(/şehir merkezine \d+ km/);
  await expect(row(page, 'Cervecería La Campana').getByTestId('import-row-badge')).toHaveText('Konumlu'); // JSON koordinatı: aramasız
  await expect(row(page, 'Café La Campana').getByTestId('import-row-match')).toContainText('Café La Campana · Calle Mayor 10');
  await expect(row(page, 'Çiya Sofrası').getByTestId('import-row-match')).toContainText('Çiya Sofrası');

  // Kontrol et süzgeci
  await tid(page, 'import-filter-check').click();
  await expect(tid(page, 'import-row')).toHaveCount(1);
  await expect(tid(page, 'import-filter-check')).toHaveText('Kontrol et (1)');
  // Alternatifler: başka bir sonuç seçilebilir ya da "Konumsuz ekle"
  await basso.click();
  await expect(basso.getByTestId('import-alt')).toHaveCount(1);
  await expect(basso.getByTestId('import-alt-name')).toHaveText('Bar Basso');
  await basso.getByTestId('import-alt-none').click();
  await expect(tid(page, 'import-filter-check')).toHaveText('Kontrol et (0)');
  await tid(page, 'import-filter-none').click();
  await expect(tid(page, 'import-filter-none')).toHaveText('Konumsuz (2)');
  await expect(tid(page, 'import-row-name')).toHaveText(['Trattoria Inesistente', 'Bar Basso']);
  // Bulunamayan yer başka bir adla yeniden aranabilir; sonra yine konumsuz bırakılır.
  const enzo = row(page, 'Trattoria Inesistente');
  await enzo.click();
  await enzo.getByTestId('import-research-input').fill('Colosseo');
  await enzo.getByTestId('import-research').click();
  await expect(enzo.getByTestId('import-row-match')).toContainText('Colosseo');
  await expect(enzo.getByTestId('import-row-badge')).toHaveText('Kontrol et'); // ad çok farklı
  await expect(enzo.getByTestId('import-alt-name')).toHaveText(['Colosseo']); // seçenekler açık kalır
  await enzo.getByTestId('import-alt-none').click();
  await expect(enzo.getByTestId('import-row-badge')).toHaveText('Konumsuz');
  await tid(page, 'import-filter-all').click();

  // AC-MOB-35: içe aktar ve özet
  await tid(page, 'import-commit').click();
  await expect(tid(page, 'import-summary')).toHaveText('3 liste, 6 yer; 2 yer konumsuz (2 yer zaten listedeydi)');
  await expect(tid(page, 'import-done-list')).toHaveCount(3);

  const mine = (await (await api.get('/lists/mine')).json()) as { id: number; title: string; city: string; itemCount: number }[];
  const romaList = mine.find((l) => l.title === 'Roma yemek');
  const madridList = mine.find((l) => l.title === 'Madrid yıldızlılar');
  expect(romaList).toMatchObject({ city: 'Roma', itemCount: 3 });
  expect(madridList).toMatchObject({ city: 'Madrid', itemCount: 2 });
  expect(mine.filter((l) => l.title === 'İstanbul kahve')).toHaveLength(1); // yeni liste açılmadı
  expect(mine.find((l) => l.city === 'İstanbul' && l.title === 'Saved Places')).toBeUndefined(); // aktarılmayan grup

  const items = async (id: number) => ((await (await api.get(`/lists/${id}`)).json()).items as Record<string, unknown>[])
    .map(({ provider, providerId, name, lat, category, note, details }) => ({ provider, providerId, name, located: lat !== null, category, note, details }));
  expect(await items(romaList!.id)).toEqual([
    { provider: 'fake', providerId: 'fake-roscioli', name: 'Roscioli Salumeria', located: true, category: 'food', note: 'Carbonara, cacio e pepe\nRezervasyon şart', details: { googleMapsUrl: ROSCIOLI_URL } },
    { provider: 'voyage', providerId: 'trattoria inesistente@roma', name: 'Trattoria Inesistente', located: false, category: 'food', note: '', details: { googleMapsUrl: ENZO_URL } },
    { provider: 'voyage', providerId: 'bar basso@roma', name: 'Bar Basso', located: false, category: 'food', note: 'Negroni sbagliato', details: { googleMapsUrl: 'https://maps.app.goo.gl/BarBasso' } },
  ]);
  // Mevcut liste: eski öğeler korunur (not dahil), Kronotrop tekrar eklenmez, Çiya kategoriyi aramadan alır
  expect(await items(existing)).toEqual([
    { provider: 'fake', providerId: 'fake-kronotrop', name: 'Kronotrop', located: true, category: 'coffee', note: 'eski not', details: {} },
    { provider: 'voyage', providerId: 'galata@istanbul', name: 'Galata', located: false, category: 'historic', note: '', details: {} },
    { provider: 'fake', providerId: 'fake-ciya', name: 'Çiya Sofrası', located: true, category: 'food', note: 'Kebap, perde pilavı', details: {} },
  ]);
  expect(await items(madridList!.id)).toEqual([
    { provider: 'voyage', providerId: 'cervecería la campana@40.415,-3.708', name: 'Cervecería La Campana', located: true, category: 'other', note: '', details: { googleMapsUrl: 'https://maps.google.com/?cid=1111111111' } },
    { provider: 'fake', providerId: 'fake-campana-cafe', name: 'Café La Campana', located: true, category: 'coffee', note: 'Churros', details: { googleMapsUrl: 'https://maps.google.com/?cid=2222222222' } },
  ]);

  // AC-MOB-36: "Google Maps'te aç" içe aktarılan bağlantıyı birebir açar; bağlantısı olmayan yer eskisi gibi adla aranır.
  await tid(page, 'import-done-list').filter({ hasText: 'Roma yemek' }).click();
  await expect(tid(page, 'list-detail-title')).toHaveText('Roma yemek');
  await expect(tid(page, 'place-item-note').first()).toHaveText('Carbonara, cacio e pepe\nRezervasyon şart');
  // (sayfa yüklemesi kayıtları sıfırlar: her açılış kendi sayfasında doğrulanır)
  await tid(page, 'place-item').filter({ hasText: 'Roscioli Salumeria' }).getByTestId('place-maps').click();
  expect(await openedUrls(page)).toEqual([ROSCIOLI_URL]);
  await page.goto(`/lists/${existing}`);
  await tid(page, 'place-item').filter({ hasText: 'Kronotrop' }).getByTestId('place-maps').click();
  expect(await openedUrls(page)).toEqual(['https://www.google.com/maps/search/?api=1&query=Kronotrop%2C%20%C4%B0stanbul']);
  await page.goto(`/lists/${madridList!.id}?tab=map`);
  await tid(page, 'map-pin').filter({ hasText: 'Café La Campana' }).click();
  await tid(page, 'map-card-maps').click();
  expect(await openedUrls(page)).toEqual(['https://maps.google.com/?cid=2222222222']);

  // Düzenle ile kaydetmek Google bağlantısını silmez.
  await page.goto(`/lists/${romaList!.id}`);
  await tid(page, 'place-item').filter({ hasText: 'Bar Basso' }).getByTestId('place-edit').click();
  await page.getByTestId('add-place-sheet').getByTestId('place-cat-bar').click();
  await page.getByTestId('add-place-sheet').getByTestId('place-save').click();
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);
  expect((await items(romaList!.id))[2]).toMatchObject({ category: 'bar', details: { googleMapsUrl: 'https://maps.app.goo.gl/BarBasso' } });
  await api.dispose();
});

test('AC-MOB-34: aynı anda en çok 2 arama, ilerleme çubuğu, iptal ve devam', async ({ page }) => {
  test.setTimeout(90_000);
  await register(page);
  let inFlight = 0, maxInFlight = 0, total = 0;
  await page.route('**/search/places**', async (route) => {
    total++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 250));
    inFlight--;
    await route.continue().catch(() => undefined);
  });
  const names = ['Colosseo', 'Musei Vaticani', 'Villa Borghese', 'Roscioli', "Sant'Eustachio", 'Yok Böyle Bir Yer 1', 'Yok Böyle Bir Yer 2',
    'Yok Böyle Bir Yer 3', 'Yok Böyle Bir Yer 4', 'Yok Böyle Bir Yer 5', 'Yok Böyle Bir Yer 6', 'Yok Böyle Bir Yer 7'];
  await openImport(page);
  await pickFiles(page, [csvFile(`Roma ${uniq('c')}.csv`, ['Title,Note,URL', ...names.map((n) => `"${n}",,`)].join('\n'))]);
  await tid(page, 'import-match-start').click();
  await expect(tid(page, 'import-progress-text')).toHaveText(/Eşleştiriliyor… [1-9]\d* \/ 12/);
  await tid(page, 'import-cancel').click();
  await expect(tid(page, 'import-progress-text')).toHaveText(/Durduruldu · \d+ \/ 12/);
  const stoppedAt = total;
  expect(stoppedAt).toBeLessThan(12);
  await page.waitForTimeout(600);
  expect(total).toBe(stoppedAt); // iptalden sonra yeni istek yok
  // durdurulmuşken aranmayanlar "Bekliyor"; içe aktarılırsa konumsuz eklenirler
  await expect(tid(page, 'import-row-badge').filter({ hasText: 'Bekliyor' }).first()).toBeVisible();
  await tid(page, 'import-resume').click();
  await waitMatched(page);
  expect(total).toBe(12);
  expect(maxInFlight).toBe(2);
  await expect(row(page, 'Colosseo').getByTestId('import-row-badge')).toHaveText('Eşleşti');
  await expect(tid(page, 'import-filter-none')).toHaveText('Konumsuz (7)');
});

test('AC-MOB-35: büyük liste (520 yer) donmadan eşleşir; 500 sınırı için ikinci liste açılır; mevcut listeye eklemek öğeleri korur', async ({ page }) => {
  test.setTimeout(180_000);
  await register(page);
  const api = await apiFor(page);
  // Arama yanıtını tarayıcıda taklit et (sunucuya 520 istek atmadan); her yer için tek, yakın bir sonuç.
  await page.route('**/search/places**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const n = Number(/(\d+)$/.exec(q)?.[1] ?? 0);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify([{ provider: 'fake', providerId: `bulk-${n}`, name: q, address: 'Roma', lat: 41.89 + n / 10000, lon: 12.48, category: 'food' }]) });
  });
  const title = `Toplu ${uniq('b')}`;
  const rows = ['Title,Note,URL', ...Array.from({ length: 520 }, (_, i) => `"Yer, no ${i}",not ${i},https://maps.app.goo.gl/x${i}`)];
  await openImport(page);
  await pickFiles(page, [csvFile(`${title}.csv`, rows.join('\r\n'))]);
  const card = tid(page, 'import-file');
  await expect(card.getByTestId('import-file-count')).toHaveText('520 yer');
  await expect(card.getByTestId('import-city')).toHaveValue('');
  await tid(page, 'import-match-start').click();
  await expect(page.getByText('şehir gerekli')).toBeVisible();
  await card.getByTestId('import-city').fill('Roma');
  await tid(page, 'import-match-start').click();
  // Eşleşirken arayüz yanıt verir (süzgeç anında değişir).
  await expect(tid(page, 'import-progress-text')).toHaveText(/Eşleştiriliyor…/);
  const t0 = Date.now();
  await tid(page, 'import-filter-check').click();
  await expect(tid(page, 'import-filter-check')).toHaveAttribute('aria-selected', 'true');
  expect(Date.now() - t0).toBeLessThan(1500);
  await tid(page, 'import-filter-all').click();
  await waitMatched(page);
  await expect(tid(page, 'import-progress-text')).toHaveText('Eşleştirme bitti · 520 yer');
  await tid(page, 'import-commit').click();
  await expect(tid(page, 'import-summary')).toHaveText('2 liste, 520 yer', { timeout: 30_000 });
  const mine = (await (await api.get('/lists/mine')).json()) as { id: number; title: string; itemCount: number }[];
  expect(mine.find((l) => l.title === title)?.itemCount).toBe(500);
  expect(mine.find((l) => l.title === `${title} (2)`)?.itemCount).toBe(20);

  // Aynı dosya mevcut listeye yeniden: hepsi tekrar -> eklenmez, liste bozulmaz.
  await openImport(page);
  await pickFiles(page, [csvFile(`${title}.csv`, rows.slice(0, 31).join('\n'))]);
  await expect(tid(page, 'import-file').getByTestId('import-target-existing')).toHaveAttribute('aria-checked', 'true');
  await tid(page, 'import-file').getByTestId('import-city').fill('Roma');
  await tid(page, 'import-match-start').click();
  await waitMatched(page);
  await tid(page, 'import-commit').click();
  await expect(tid(page, 'import-summary')).toHaveText('1 liste, 0 yer (30 yer zaten listedeydi)');
  expect((await (await api.get('/lists/mine')).json()).find((l: { title: string }) => l.title === title).itemCount).toBe(500);
  await api.dispose();
});
