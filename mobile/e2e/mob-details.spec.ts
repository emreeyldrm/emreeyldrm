import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { addPlace, createList, openNewPlace, png, register, tid, uniq, userSession } from './helpers';

// Yer detayları ve fotoğraflar (docs/ACCEPTANCE.md, DET): AC-MOB-21..25.

const COLORS: [number, number, number][] = [[46, 125, 91], [242, 140, 40], [47, 95, 158], [158, 51, 89], [92, 84, 179], [11, 124, 138], [143, 106, 0]];
const photo = (i: number) => ({ name: `foto-${i}.png`, mimeType: 'image/png', buffer: png(48 + i, 32 + i, COLORS[i % COLORS.length]) });

/** Clicks a picker button and feeds the browser's file chooser (expo-image-picker web uses a file input). */
async function choosePhotos(page: Page, button: Locator, count: number, from = 0) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(Array.from({ length: count }, (_, i) => photo(from + i)));
}

type PutItem = { provider: string; providerId: string; name: string; category?: string; note?: string; details?: Record<string, unknown> };
function nextPut(page: Page): Promise<PutItem[]> {
  return page
    .waitForRequest((r) => r.method() === 'PUT' && /\/lists\/\d+\/items$/.test(r.url()))
    .then((r) => (JSON.parse(r.postData() ?? '{}') as { items: PutItem[] }).items);
}

/** Holds POST /media requests until `release()` (to observe the "uploading" state); later uploads pass through. */
async function holdUploads(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/media', async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.fallback();
  });
  return { release: () => release() };
}

/** Every thumbnail image in `scope` is loaded from GET /media/<id> on the API. */
async function expectMediaImages(scope: Locator, n: number) {
  const imgs = scope.locator('img[src*="/media/"]');
  await expect(imgs).toHaveCount(n);
  for (let i = 0; i < n; i++) {
    await expect(imgs.nth(i)).toHaveAttribute('src', /^https?:\/\/[^/]+\/media\/[0-9a-f]{32}$/);
    expect(await imgs.nth(i).evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
}

async function openSheet(page: Page) {
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

test('AC-MOB-21: "Detaylar" bölümü: servis, bekleme, favori etiketleri, kişi başı harcama ve şehrin para birimi', async ({ page }) => {
  await register(page);
  await createList(page, 'Roma', `Detay ${uniq('d')}`);
  const sheet = await openSheet(page);
  await sheet.getByTestId('place-name').fill('Trattoria da Enzo');

  // Yemek: bölüm varsayılan açık; servis seçenekleri görünür
  await expect(sheet.getByTestId('details-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(sheet.getByTestId('details-section')).toBeVisible();
  await expect(sheet.getByTestId('wait-dine-in-0-10')).toHaveCount(0);
  await sheet.getByTestId('svc-dine-in').click();
  await expect(sheet.getByTestId('svc-dine-in')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('wait-dine-in-45plus')).toHaveText('45+ dk');
  await sheet.getByTestId('wait-dine-in-20-30').click();
  await expect(sheet.getByTestId('wait-dine-in-20-30')).toHaveAttribute('aria-checked', 'true');
  await sheet.getByTestId('svc-takeout').click();
  await sheet.getByTestId('wait-takeout-0-10').click();

  // favori yiyecekler: Enter ya da "Ekle" ile eklenir, × ile silinir
  await sheet.getByTestId('fav-input').fill('Carbonara');
  await sheet.getByTestId('fav-input').press('Enter');
  await sheet.getByTestId('fav-input').fill('  Tiramisù ');
  await sheet.getByTestId('fav-add').click();
  await expect(sheet.getByTestId('fav-tag')).toHaveText(['Carbonara', 'Tiramisù']);
  await sheet.getByTestId('fav-tag').filter({ hasText: 'Carbonara' }).getByTestId('fav-remove').click();
  await expect(sheet.getByTestId('fav-tag')).toHaveText(['Tiramisù']);
  await sheet.getByTestId('fav-input').fill('Supplì');
  await sheet.getByTestId('fav-input').press('Enter');

  // kişi başı: para birimi listenin şehrinden (Roma -> EUR), değiştirilebilir
  await expect(sheet.getByTestId('spend-currency')).toHaveText(/EUR/);
  await sheet.getByTestId('spend-currency').click();
  await sheet.getByTestId('currency-USD').click();
  await expect(sheet.getByTestId('spend-currency')).toHaveText(/USD/);
  await sheet.getByTestId('spend-currency').click();
  await sheet.getByTestId('currency-EUR').click();
  await sheet.getByTestId('spend-amount').fill('12,5');

  // başka kategori: servis/favoriler yok, harcama ve fotoğraf var; bölüm varsayılan kapalı
  await sheet.getByTestId('place-cat-museum').click();
  await expect(sheet.getByTestId('details-section')).toHaveCount(0);
  await sheet.getByTestId('details-toggle').click();
  await expect(sheet.getByTestId('svc-dine-in')).toHaveCount(0);
  await expect(sheet.getByTestId('fav-input')).toHaveCount(0);
  await expect(sheet.getByTestId('spend-amount')).toHaveValue('12,5');
  await expect(sheet.getByTestId('place-photos-add-library')).toBeVisible();
  await sheet.getByTestId('place-cat-food').click();
  await expect(sheet.getByTestId('svc-dine-in')).toHaveAttribute('aria-checked', 'true'); // seçimler korunur

  const put = nextPut(page);
  await sheet.getByTestId('place-add').click();
  const items = await put;
  expect(items[0].details).toEqual({
    dineIn: true, waitDineIn: '20-30', takeout: true, waitTakeout: '0-10',
    favorites: ['Tiramisù', 'Supplì'], spendPerPerson: 12.5, currency: 'EUR',
  });
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);
  const row = tid(page, 'place-item').filter({ hasText: 'Trattoria da Enzo' });
  await expect(row.getByTestId('place-item-summary')).toHaveText('Masada 20-30 dk · Paket 0-10 dk · ~12,5 €');
  await expect(row.getByTestId('place-item-favorites')).toHaveText('Favoriler: Tiramisù, Supplì');

  // detaysız yer: özet yok; bilinmeyen şehirde para birimi TRY
  await addPlace(page, 'Sade Yer', 'park');
  await expect(tid(page, 'place-item').filter({ hasText: 'Sade Yer' }).getByTestId('place-item-summary')).toHaveCount(0);
  await createList(page, `Köy${uniq('k')}`, `Bilinmeyen ${uniq('b')}`);
  const s2 = await openSheet(page);
  await expect(s2.getByTestId('spend-currency')).toHaveText(/TRY/);
  await createList(page, 'Londra', `Londra ${uniq('l')}`);
  const s3 = await openSheet(page);
  await expect(s3.getByTestId('spend-currency')).toHaveText(/GBP/);
});

test('AC-MOB-22: masada 30+ dk bekleme ve paket varsa öneri kendiliğinden "Paket" olur; kullanıcı değiştirebilir', async ({ page }) => {
  await register(page);
  await createList(page, 'İstanbul', `Öneri ${uniq('o')}`);
  const sheet = await openSheet(page);
  await sheet.getByTestId('place-name').fill('Dürümcü Emmi');
  await sheet.getByTestId('svc-dine-in').click();
  await sheet.getByTestId('wait-dine-in-30-45').click();
  // paket yokken öneri yok
  await expect(sheet.getByTestId('rec-reason')).toHaveCount(0);
  await expect(sheet.getByTestId('rec-takeout')).toHaveAttribute('aria-checked', 'false');
  await sheet.getByTestId('svc-takeout').click();
  await expect(sheet.getByTestId('rec-takeout')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('rec-reason')).toHaveText('Masada 30-45 dk bekleme var, paket almak daha mantıklı');
  // bekleme kısalınca otomatik öneri kalkar; 45+ olunca geri gelir
  await sheet.getByTestId('wait-dine-in-10-20').click();
  await expect(sheet.getByTestId('rec-reason')).toHaveCount(0);
  await expect(sheet.getByTestId('rec-takeout')).toHaveAttribute('aria-checked', 'false');
  await sheet.getByTestId('wait-dine-in-45plus').click();
  await expect(sheet.getByTestId('rec-reason')).toHaveText('Masada 45+ dk bekleme var, paket almak daha mantıklı');

  // kullanıcı değiştirir: seçimi korunur, açıklama gizlenir
  await sheet.getByTestId('rec-dine_in').click();
  await expect(sheet.getByTestId('rec-dine_in')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('rec-reason')).toHaveCount(0);
  await sheet.getByTestId('wait-dine-in-30-45').click();
  await expect(sheet.getByTestId('rec-dine_in')).toHaveAttribute('aria-checked', 'true');
  await sheet.getByTestId('rec-takeout').click();
  await expect(sheet.getByTestId('rec-takeout')).toHaveAttribute('aria-checked', 'true');

  const put = nextPut(page);
  await sheet.getByTestId('place-add').click();
  expect((await put)[0].details).toMatchObject({ recommendation: 'takeout', waitDineIn: '30-45', dineIn: true, takeout: true });
  await expect(tid(page, 'place-item').getByTestId('place-item-summary')).toHaveText('Paket önerilir · Masada 30-45 dk · Paket');
  await expect(tid(page, 'place-item').getByTestId('place-item-summary')).toHaveCSS('font-family', /PlusJakartaSans/);
});

test('AC-MOB-23: en çok 6 fotoğraf eklenir, yüklenir, küçük resim olur ve silinir; yüklenirken "Ekle" bekler; hata gösterilir', async ({ page }) => {
  await register(page);
  await createList(page, 'Roma', `Foto ${uniq('f')}`);
  const sheet = await openSheet(page);
  await sheet.getByTestId('place-name').fill('Pizzeria Foto');
  const thumbs = sheet.getByTestId('place-photos-thumb');

  // yükleme sürerken "Ekle" devre dışı
  const hold = await holdUploads(page);
  await choosePhotos(page, sheet.getByTestId('place-photos-add-library'), 2);
  await expect(thumbs).toHaveCount(2);
  await expect(sheet.getByTestId('place-photos-uploading')).toHaveCount(2);
  await expect(sheet.getByTestId('photos-busy')).toHaveText('Fotoğraflar yükleniyor…');
  await expect(sheet.getByTestId('place-add')).toHaveAttribute('aria-disabled', 'true');
  hold.release();
  await expect(sheet.getByTestId('place-photos-uploading')).toHaveCount(0);
  await expect(thumbs.nth(0)).toHaveAttribute('data-status', 'done');
  await expect(thumbs.nth(1)).toHaveAttribute('data-status', 'done');
  await expect(sheet.getByTestId('place-add')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(sheet.getByTestId('place-photos-count')).toHaveText('2/6');

  // hata: sunucu reddederse Türkçe mesaj; hatalı fotoğraf kaldırılabilir
  const tooLarge = (route: Route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ error: 'too large' }), headers: { 'Access-Control-Allow-Origin': '*' } })
    : route.fallback();
  await page.route('**/media', tooLarge);
  await choosePhotos(page, sheet.getByTestId('place-photos-add-library'), 1, 2);
  await expect(sheet.getByTestId('place-photos-error')).toHaveText('Fotoğraf çok büyük (en çok 5 MB).');
  await expect(sheet.getByTestId('place-photos-failed')).toHaveCount(1);
  await page.unroute('**/media', tooLarge);
  await thumbs.nth(2).getByTestId('place-photos-remove').click();
  await expect(thumbs).toHaveCount(2);
  await expect(sheet.getByTestId('place-photos-error')).toHaveCount(0);

  // en çok 6: 5 seçilse de 4'ü alınır; dolunca ekleme düğmesi kalkar
  await choosePhotos(page, sheet.getByTestId('place-photos-add-library'), 5, 2);
  await expect(thumbs).toHaveCount(6);
  await expect(sheet.locator('[data-testid="place-photos-thumb"][data-status="done"]')).toHaveCount(6);
  await expect(sheet.getByTestId('place-photos-add-library')).toHaveCount(0);
  await expect(sheet.getByTestId('place-photos-count')).toHaveText('6/6');
  // silinir
  await thumbs.nth(0).getByTestId('place-photos-remove').click();
  await expect(thumbs).toHaveCount(5);
  await expect(sheet.getByTestId('place-photos-add-library')).toBeVisible();

  const put = nextPut(page);
  await sheet.getByTestId('place-add').click();
  const photos = (await put)[0].details?.photos as string[];
  expect(photos).toHaveLength(5);
  for (const id of photos) expect(id).toMatch(/^[0-9a-f]{32}$/);

  // listede küçük resimler GET /media/<id> ile yüklenir; dokununca tam ekran açılır
  const row = tid(page, 'place-item').filter({ hasText: 'Pizzeria Foto' });
  await expect(row.getByTestId('photo-thumb')).toHaveCount(5);
  await expectMediaImages(row.getByTestId('place-item-photos'), 5);
  await row.getByTestId('photo-thumb').nth(1).click();
  await expect(tid(page, 'photo-viewer')).toBeVisible();
  await expect(tid(page, 'photo-viewer-count')).toHaveText('2 / 5');
  await expectMediaImages(tid(page, 'photo-viewer'), 1);
  await tid(page, 'photo-viewer-next').click();
  await expect(tid(page, 'photo-viewer-count')).toHaveText('3 / 5');
  await tid(page, 'photo-viewer-close').click();
  await expect(tid(page, 'photo-viewer')).toHaveCount(0);
});

test('AC-MOB-24: listede detay özeti ve fotoğraflar; sahibi "Düzenle" ile değiştirir, diğer yerler korunur; herkese açık listede başkası görür', async ({ page, browser }) => {
  await register(page);
  const title = `Düzenle ${uniq('e')}`;
  await createList(page, 'Roma', title);
  // ilk yer: arama sonucundan (sağlayıcı kimliği), detay ve fotoğraflı
  let sheet = await openSheet(page);
  await sheet.getByTestId('place-name').pressSequentially('colos', { delay: 30 });
  await sheet.getByTestId('place-suggest-result').filter({ hasText: 'Colosseo' }).click();
  await sheet.getByTestId('details-toggle').click(); // tarihi yer: kapalı gelir
  await sheet.getByTestId('spend-amount').fill('18');
  await choosePhotos(page, sheet.getByTestId('place-photos-add-library'), 1);
  await expect(sheet.locator('[data-testid="place-photos-thumb"][data-status="done"]')).toHaveCount(1);
  await sheet.getByTestId('place-add').click();
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);

  // ikinci yer: elle, servis detaylı ve 2 fotoğraflı
  sheet = await openSheet(page);
  await sheet.getByTestId('place-name').fill('Forno Campo');
  await sheet.getByTestId('svc-dine-in').click();
  await sheet.getByTestId('wait-dine-in-30-45').click();
  await sheet.getByTestId('svc-takeout').click();
  await sheet.getByTestId('spend-amount').fill('12');
  await sheet.getByTestId('fav-input').fill('Pizza bianca');
  await sheet.getByTestId('fav-add').click();
  await choosePhotos(page, sheet.getByTestId('place-photos-add-library'), 2, 3);
  await expect(sheet.locator('[data-testid="place-photos-thumb"][data-status="done"]')).toHaveCount(2);
  await sheet.getByTestId('place-add').click();
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);

  const forno = tid(page, 'place-item').filter({ hasText: 'Forno Campo' });
  await expect(forno.getByTestId('place-item-summary')).toHaveText('Paket önerilir · Masada 30-45 dk · Paket · ~12 €');
  await expectMediaImages(forno, 2);
  const colosseo = tid(page, 'place-item').filter({ hasText: 'Colosseo' });
  await expect(colosseo.getByTestId('place-item-summary')).toHaveText('~18 €');
  await expectMediaImages(colosseo, 1);

  // Düzenle: önceki değerlerle dolu açılır; "Kaydet"
  await forno.getByTestId('place-edit').click();
  sheet = page.getByTestId('add-place-sheet');
  await expect(sheet.getByTestId('edit-place-name')).toHaveText('Forno Campo');
  await expect(sheet.getByTestId('place-add')).toHaveCount(0);
  await expect(sheet.getByTestId('place-name')).toHaveCount(0);
  await expect(sheet.getByTestId('svc-dine-in')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('wait-dine-in-30-45')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('rec-takeout')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('rec-reason')).toBeVisible();
  await expect(sheet.getByTestId('fav-tag')).toHaveText(['Pizza bianca']);
  await expect(sheet.getByTestId('spend-amount')).toHaveValue('12');
  await expect(sheet.getByTestId('spend-currency')).toHaveText(/EUR/);
  await expect(sheet.getByTestId('place-photos-thumb')).toHaveCount(2);
  await expectMediaImages(sheet.getByTestId('place-photos'), 2);
  // değiştir: tutar, bir fotoğraf sil, bir fotoğraf ekle, öneriyi "İkisi de olur" yap, not ekle
  await sheet.getByTestId('spend-amount').fill('15');
  await sheet.getByTestId('place-photos-thumb').nth(0).getByTestId('place-photos-remove').click();
  await choosePhotos(page, sheet.getByTestId('place-photos-add-library'), 1, 5);
  await expect(sheet.locator('[data-testid="place-photos-thumb"][data-status="done"]')).toHaveCount(2);
  await sheet.getByTestId('rec-either').click();
  await sheet.getByTestId('place-note').fill('Öğlen kalabalık');
  const before = await nextPutAfter(page, () => sheet.getByTestId('place-save').click());
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);

  // PUT tüm listeyi yazar: Colosseo kimliği ve detayları aynen korunur
  const col = before.find((i) => i.name === 'Colosseo')!;
  expect(col).toMatchObject({ provider: 'fake', providerId: 'fake-colosseo' });
  expect(col.details).toMatchObject({ spendPerPerson: 18, currency: 'EUR' });
  expect((col.details?.photos as string[]).length).toBe(1);
  const fo = before.find((i) => i.name === 'Forno Campo')!;
  expect(fo.provider).toBe('voyage');
  expect(fo.note).toBe('Öğlen kalabalık');
  expect(fo.details).toMatchObject({ spendPerPerson: 15, recommendation: 'either', favorites: ['Pizza bianca'] });
  expect((fo.details?.photos as string[]).length).toBe(2);

  await expect(forno.getByTestId('place-item-summary')).toHaveText('Masada ya da paket · Masada 30-45 dk · Paket · ~15 €');
  await expect(forno.getByTestId('place-item-note')).toHaveText('Öğlen kalabalık');
  await expectMediaImages(forno, 2);
  await expectMediaImages(colosseo, 1);

  // herkese açık listede başkası özeti ve fotoğrafları görür (düzenleyemez)
  const listPath = new URL(page.url()).pathname;
  await tid(page, 'list-share').click();
  await tid(page, 'visibility-public').click();
  await tid(page, 'share-done').click();
  await expect(tid(page, 'list-detail-visibility')).toHaveText('Herkese açık');
  const other = await userSession(browser, 'det');
  await other.page.goto(listPath);
  await expect(tid(other.page, 'list-detail-title')).toHaveText(title);
  const theirs = tid(other.page, 'place-item').filter({ hasText: 'Forno Campo' });
  await expect(theirs.getByTestId('place-item-summary')).toHaveText('Masada ya da paket · Masada 30-45 dk · Paket · ~15 €');
  await expectMediaImages(theirs, 2);
  await expect(tid(other.page, 'place-edit')).toHaveCount(0);
  await theirs.getByTestId('photo-thumb').first().click();
  await expect(tid(other.page, 'photo-viewer')).toBeVisible();
  await tid(other.page, 'photo-viewer-close').click();
  await other.ctx.close();
});

async function nextPutAfter(page: Page, action: () => Promise<unknown>): Promise<PutItem[]> {
  const put = nextPut(page);
  await action();
  return put;
}

test('AC-MOB-25: yorum yazarken en çok 4 fotoğraf eklenir, gönderilmeden kaldırılır; gönderilen yorumda küçük resimler büyür', async ({ page }) => {
  await register(page);
  await openNewPlace(page, 'İstanbul', `Fotoğraflı Yer ${uniq('p')}`);
  const strip = tid(page, 'comment-photo-strip');

  // yükleme sürerken gönder devre dışı
  const hold = await holdUploads(page);
  await choosePhotos(page, tid(page, 'comment-photo'), 2);
  await expect(strip.getByTestId('comment-photo-strip-thumb')).toHaveCount(2);
  await expect(strip.getByTestId('comment-photo-strip-uploading')).toHaveCount(2);
  await expect(tid(page, 'comment-submit')).toHaveAttribute('aria-disabled', 'true');
  hold.release();
  await expect(strip.locator('[data-status="done"]')).toHaveCount(2);
  await expect(tid(page, 'comment-submit')).not.toHaveAttribute('aria-disabled', 'true');

  // en çok 4: 3 seçilse de 2'si alınır, düğme devre dışı kalır; biri gönderilmeden kaldırılır
  await choosePhotos(page, tid(page, 'comment-photo'), 3, 2);
  await expect(strip.locator('[data-status="done"]')).toHaveCount(4);
  await expect(tid(page, 'comment-photo')).toHaveAttribute('aria-disabled', 'true');
  await strip.getByTestId('comment-photo-strip-remove').first().click();
  await expect(strip.getByTestId('comment-photo-strip-thumb')).toHaveCount(3);
  await expect(tid(page, 'comment-photo')).not.toHaveAttribute('aria-disabled', 'true');

  const post = page.waitForRequest((r) => r.method() === 'POST' && /\/places\/\d+\/comments$/.test(r.url()));
  await tid(page, 'comment-body').fill('Manzara harika');
  await tid(page, 'comment-submit').click();
  const sent = JSON.parse((await post).postData() ?? '{}') as { photos: string[] };
  expect(sent.photos).toHaveLength(3);
  const c = tid(page, 'comment').filter({ hasText: 'Manzara harika' });
  await expect(c).toBeVisible();
  await expect(tid(page, 'comment-photo-strip')).toHaveCount(0); // gönderince temizlenir
  await expectMediaImages(c.getByTestId('comment-photos'), 3);
  await c.getByTestId('photo-thumb').nth(2).click();
  await expect(tid(page, 'photo-viewer')).toBeVisible();
  await expect(tid(page, 'photo-viewer-count')).toHaveText('3 / 3');
  await tid(page, 'photo-viewer-close').click();
  await expect(tid(page, 'photo-viewer')).toHaveCount(0);

  // yalnızca fotoğraflı yorum (metinsiz) da gönderilir; hiçbiri yoksa uyarı
  await tid(page, 'comment-submit').click();
  await expect(tid(page, 'error')).toHaveText('Yorum boş olamaz.');
  await choosePhotos(page, tid(page, 'comment-photo'), 1, 6);
  await expect(strip.locator('[data-status="done"]')).toHaveCount(1);
  await tid(page, 'comment-submit').click();
  await expect(tid(page, 'comment')).toHaveCount(2);
  await expectMediaImages(tid(page, 'comment').first().getByTestId('comment-photos'), 1);

  // yeniden yüklenince de görünür
  await page.reload();
  await expect(tid(page, 'comment-photos')).toHaveCount(2);
});
