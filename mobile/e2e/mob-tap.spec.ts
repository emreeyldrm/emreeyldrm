import { deflateSync } from 'node:zlib';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { addPlace, createList, newAccount, openedUrls, register, stubWindowOpen, tid, uniq } from './helpers';

// Haritada dokunarak yer seçme (docs/ACCEPTANCE.md, TAP): AC-MOB-28..30.
// API SEARCH_PROVIDER=fake ile çalışır: /search/nearby fikstürler içinden 300 m içindekileri en yakından döner.
// Web derlemesinde harita yok; "Bu noktada ara" (koordinat) aynı yakın-yer akışını ve aynı kartı çalıştırır.

const apiUrl = () => test.info().config.metadata.apiUrl as string;
const NEAR_COLOSSEO = { lat: 41.8904, lon: 12.4925 };
const NEAR_ROSCIOLI = { lat: 41.8936, lon: 12.4732 };
// Cervecería La Campana (~23 m) ile Café La Campana (~113 m)
const NEAR_CAMPANA = { lat: 40.4150, lon: -3.7077 };

interface ApiUser { handle: string; auth: { Authorization: string } }

async function apiUser(ctx: APIRequestContext, p: string): Promise<ApiUser> {
  const acc = newAccount(p);
  const res = await ctx.post('/auth/register', { data: acc });
  expect(res.status()).toBe(201);
  return { handle: acc.handle, auth: { Authorization: `Bearer ${(await res.json()).token}` } };
}

/** Same body the app sends for a fixture (fake provider) place. */
async function resolve(ctx: APIRequestContext, u: ApiUser, providerId: string, name: string, lat: number, lon: number, category: string): Promise<number> {
  const res = await ctx.post('/places/resolve', { headers: u.auth, data: { provider: 'fake', providerId, name, lat, lon, category } });
  expect(res.status()).toBe(200);
  return (await res.json()).placeId as number;
}

async function tapAt(page: Page, p: { lat: number; lon: number }) {
  if (!(await tid(page, 'tap-panel').isVisible())) await tid(page, 'tap-open').click();
  await tid(page, 'tap-lat').fill(String(p.lat));
  await tid(page, 'tap-lon').fill(String(p.lon));
  await tid(page, 'tap-search').click();
}

/** Tiny valid PNG for a comment photo uploaded through the API. */
function png(): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([242, 140, 40])))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 8 }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

test('AC-MOB-28: haritaya dokununca yakındaki en yakın yer kartta açılır, geçici işaret konur; "Başka bir yer mi?" diğerlerini listeler', async ({ page }) => {
  await register(page);
  await createList(page, 'Roma', `Dokun ${uniq('t')}`);
  await addPlace(page, 'Pantheon', 'historic', '', { lat: 41.8986, lon: 12.4769 });
  await tid(page, 'seg-map').click();

  // Colosseo'nun yanına dokun: istek dokunulan koordinatla ve cihaz diliyle gider
  const req = page.waitForRequest((r) => r.url().includes('/search/nearby'));
  await tapAt(page, NEAR_COLOSSEO);
  const url = new URL((await req).url());
  expect([url.searchParams.get('lat'), url.searchParams.get('lon')]).toEqual(['41.890400', '12.492500']);
  expect(url.searchParams.get('lang')).toMatch(/^[a-z]{2}$/);
  await expect(tid(page, 'search-card-name')).toHaveText('Colosseo');
  await expect(tid(page, 'search-card-category')).toHaveText('Tarihi');
  await expect(tid(page, 'search-card-address')).toHaveText('Piazza del Colosseo 1, Roma, İtalya');
  await expect(tid(page, 'tap-pin')).toHaveCount(1);
  await expect(tid(page, 'tap-pin-name')).toHaveText('Colosseo');
  await expect(tid(page, 'search-card-others-toggle')).toHaveCount(0); // yakında başka yer yok
  await expect(tid(page, 'map-pin')).toHaveCount(1); // kayıtlı pinler değişmez

  // iki yer yakın: en yakını kartta, diğeri "Başka bir yer mi?" altında; seçilince kart ve işaret değişir
  await tapAt(page, NEAR_CAMPANA);
  await expect(tid(page, 'search-card-name')).toHaveText('Cervecería La Campana');
  await expect(tid(page, 'search-card-distance')).toHaveText('24 m');
  const toggle = tid(page, 'search-card-others-toggle');
  await expect(toggle).toContainText('Başka bir yer mi? (1)');
  await expect(tid(page, 'search-card-other')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tid(page, 'search-card-other-name')).toHaveText(['Café La Campana']);
  await tid(page, 'search-card-other').click();
  await expect(tid(page, 'search-card-name')).toHaveText('Café La Campana');
  await expect(tid(page, 'search-card-category')).toHaveText('Kahve');
  await expect(tid(page, 'tap-pin-name')).toHaveText('Café La Campana');
  await expect(tid(page, 'search-card-other-name')).toHaveCount(0); // yeni yer için liste kapalı başlar
  await tid(page, 'search-card-others-toggle').click();
  await expect(tid(page, 'search-card-other-name')).toHaveText(['Cervecería La Campana']);

  // yakında yer yoksa anlamlı mesaj ve arama ipucu
  await tapAt(page, { lat: 0, lon: 0 });
  await expect(tid(page, 'tap-empty')).toContainText('Burada kayıtlı bir yer bulunamadı');
  await expect(tid(page, 'tap-empty')).toContainText('aramaya');
  await expect(tid(page, 'search-card')).toHaveCount(0);
  await expect(tid(page, 'tap-pin-name')).toHaveText('Dokunulan nokta');
  await tid(page, 'tap-card-close').click();
  await expect(tid(page, 'tap-card')).toHaveCount(0);
  await expect(tid(page, 'tap-pin')).toHaveCount(0);

  // kayıtlı pine dokunmak eskisi gibi kendi kartını açar (dokunma kartı kapanır)
  await tapAt(page, NEAR_COLOSSEO);
  await expect(tid(page, 'search-card-name')).toHaveText('Colosseo');
  await tid(page, 'map-pin').filter({ hasText: 'Pantheon' }).click();
  await expect(tid(page, 'map-card-name')).toHaveText('Pantheon');
  await expect(tid(page, 'search-card')).toHaveCount(0);
  await expect(tid(page, 'tap-pin')).toHaveCount(0);

  // arama çubuğundan seçim dokunma kartının yerini alır; dokunma da arama kartının
  await tid(page, 'place-search-input').pressSequentially('galata', { delay: 20 });
  await tid(page, 'place-search-result').first().click();
  await expect(tid(page, 'search-card-name')).toHaveText('Galata Kulesi');
  await expect(tid(page, 'search-pin')).toHaveCount(1);
  await tapAt(page, NEAR_COLOSSEO);
  await expect(tid(page, 'search-card-name')).toHaveText('Colosseo');
  await expect(tid(page, 'search-pin')).toHaveCount(0);
});

test('AC-MOB-29: kartta ortalama, puan sayısı, son 3 yorum; listeye eklemeden puan verilir; Listeye ekle, Google Maps ve Tüm yorumlar', async ({ page }) => {
  // Başka bir kullanıcı (API ile) Roscioli'ye yorum yazar: 5 yorum, biri "Sadece ben", biri fotoğraflı.
  const ctx = await request.newContext({ baseURL: apiUrl() });
  const other = await apiUser(ctx, 'yorumcu');
  const pid = await resolve(ctx, other, 'fake-roscioli', 'Roscioli Salumeria', 41.8937, 12.4731, 'food');
  const tag = uniq('c');
  const media = await ctx.post('/media', { headers: { ...other.auth, 'Content-Type': 'image/png' }, data: png() });
  expect(media.status()).toBe(201);
  const mediaId = (await media.json()).id as string;
  const say = async (body: string, visibility: string, photos: string[] = []) =>
    expect((await ctx.post(`/places/${pid}/comments`, { headers: other.auth, data: { body, visibility, ...(photos.length ? { photos } : {}) } })).status()).toBe(201);
  await say(`En eski ${tag}`, 'public');
  await say(`Gizli not ${tag}`, 'private');
  await say(`Birinci ${tag}`, 'public');
  await say(`İkinci ${tag}`, 'friends'); // arkadaş değiliz: görünmez
  await say(`Son yorum ${tag}`, 'public', [mediaId]);

  await stubWindowOpen(page);
  await register(page);
  await createList(page, 'Roma', `Puan ${uniq('p')}`);
  await tid(page, 'seg-map').click();
  await tapAt(page, NEAR_ROSCIOLI);
  await expect(tid(page, 'search-card-name')).toHaveText('Roscioli Salumeria');

  // son 3 görünür yorum (en yeni önce), yazar, rozet ve fotoğraf küçük resmi; gizli ve arkadaşlara özel olan yok
  const comments = tid(page, 'search-card-comment');
  await expect(comments).toHaveCount(3);
  await expect(tid(page, 'search-card-comment-text')).toHaveText([`Son yorum ${tag}`, `Birinci ${tag}`, `En eski ${tag}`]);
  await expect(comments.first().getByTestId('search-card-comment-author')).toHaveText(`@${other.handle}`);
  await expect(comments.first().getByTestId('search-card-comment-badge')).toHaveText('Herkes');
  await expect(comments.first().getByTestId('photo-thumb')).toHaveCount(1);
  await expect(tid(page, 'search-card').getByText(`Gizli not ${tag}`)).toHaveCount(0);

  // puan: listeye eklemeden anında kaydedilir; ortalama ve sayı sunucudakiyle aynı güncellenir
  const before = Number(await tid(page, 'search-card-count').innerText());
  const rated = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith(`/places/${pid}/rating`));
  await tid(page, 'search-card-star-4').click();
  expect((await rated).status()).toBe(200);
  await expect(tid(page, 'search-card-star-4')).toHaveAttribute('aria-checked', 'true');
  await expect(tid(page, 'search-card-count')).toHaveText(String(before + 1));
  const server = await (await ctx.get(`/places/${pid}`, { headers: other.auth })).json();
  const avgText = (server.rating.avg as number).toFixed(1).replace('.', ',');
  await expect(tid(page, 'search-card-avg')).toHaveText(avgText);
  await expect(tid(page, 'search-card-rate-label')).toHaveText('Kaydedildi');

  // Google Maps: adı ve adresiyle
  await tid(page, 'search-card-maps').click();
  await expect.poll(() => openedUrls(page)).toEqual([
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Roscioli Salumeria, Via dei Giubbonari 21, Roma, İtalya')}`,
  ]);

  // "Tüm yorumlar": yer sayfası, aynı ortalama ve benim puanım; liste hâlâ boş
  await tid(page, 'search-card-all-comments').click();
  await expect(page).toHaveURL(new RegExp(`/places/${pid}$`));
  await expect(tid(page, 'place-title')).toHaveText('Roscioli Salumeria');
  await expect(tid(page, 'rating-avg')).toHaveText(avgText);
  await expect(tid(page, 'rating-count')).toHaveText(String(before + 1));
  await expect(tid(page, 'star-4')).toHaveAttribute('aria-checked', 'true');
  await expect(tid(page, 'comment').filter({ hasText: `Son yorum ${tag}` })).toBeVisible();
  await page.goBack();
  await expect(tid(page, 'list-detail-title')).toBeVisible();
  await tid(page, 'seg-list').click();
  await expect(tid(page, 'places-empty')).toBeVisible();

  // "Listeye ekle": pencere dolu açılır, kaydedilen yer sağlayıcı kimliğini korur; kart kapanır, yer kalıcı pin olur
  await tid(page, 'seg-map').click();
  await tapAt(page, NEAR_ROSCIOLI);
  await expect(tid(page, 'search-card-star-4')).toHaveAttribute('aria-checked', 'true'); // puanım hatırlanır
  await tid(page, 'search-card-add').click();
  const sheet = page.getByTestId('add-place-sheet');
  await expect(sheet.getByTestId('place-name')).toHaveValue('Roscioli Salumeria');
  await expect(sheet.getByTestId('place-cat-food')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('place-coords')).toHaveText('Seçilen konum: 41.89370, 12.47310');
  const put = page.waitForRequest((r) => r.method() === 'PUT' && /\/lists\/\d+\/items$/.test(r.url()));
  await sheet.getByTestId('place-add').click();
  expect(JSON.parse((await put).postData() ?? '{}').items).toEqual([{
    provider: 'fake', providerId: 'fake-roscioli', name: 'Roscioli Salumeria', lat: 41.8937, lon: 12.4731, category: 'food', city: 'Roma',
  }]);
  await expect(tid(page, 'search-card')).toHaveCount(0);
  await expect(tid(page, 'tap-pin')).toHaveCount(0);
  await expect(tid(page, 'map-pin').filter({ hasText: 'Roscioli Salumeria' })).toHaveCount(1);
  // aynı yere tekrar dokununca "Listede var"; kayıtlı yer aynı Voyage kaydıdır (aynı yorumlar)
  await tapAt(page, NEAR_ROSCIOLI);
  await expect(tid(page, 'search-card-add')).toHaveText(/Listede var/);
  await expect(tid(page, 'search-card-comment')).toHaveCount(3);
  await ctx.dispose();
});

test('AC-MOB-29: listenin sahibi olmayan kullanıcı kartta "Listeye ekle" görmez ama puan verebilir', async ({ browser }) => {
  // Başka bir kullanıcının herkese açık listesi (API ile kurulur).
  const ctx = await request.newContext({ baseURL: apiUrl() });
  const o = await apiUser(ctx, 'sahip');
  const list = await (await ctx.post('/lists', { headers: o.auth, data: { city: 'Roma', title: `Acik ${uniq('l')}`, visibility: 'public' } })).json();
  expect((await ctx.put(`/lists/${list.id}/items`, { headers: o.auth, data: { items: [{ provider: 'voyage', providerId: `p-${uniq('x')}`, name: 'Pantheon', lat: 41.8986, lon: 12.4769, category: 'historic' }] } })).ok()).toBe(true);
  await ctx.dispose();

  const page = await browser.newPage();
  await register(page);
  await page.goto(`/lists/${list.id}?tab=map`);
  await expect(tid(page, 'map-pin')).toHaveCount(1);
  await tapAt(page, NEAR_COLOSSEO);
  await expect(tid(page, 'search-card-name')).toHaveText('Colosseo');
  await expect(tid(page, 'search-card-add')).toHaveCount(0);
  await expect(tid(page, 'search-card-maps')).toBeVisible();
  await tid(page, 'search-card-star-5').click();
  await expect(tid(page, 'search-card-star-5')).toHaveAttribute('aria-checked', 'true');
  await page.close();
});

test('AC-MOB-30: arama sonucu kartı da aynı kart: puan, son yorumlar ve "Tüm yorumlar"', async ({ page }) => {
  const ctx = await request.newContext({ baseURL: apiUrl() });
  const other = await apiUser(ctx, 'arayan');
  const pid = await resolve(ctx, other, 'fake-santeustachio', "Sant'Eustachio Il Caffè", 41.8986, 12.4755, 'coffee');
  const tag = uniq('k');
  expect((await ctx.post(`/places/${pid}/comments`, { headers: other.auth, data: { body: `Kahvesi efsane ${tag}`, visibility: 'public' } })).status()).toBe(201);
  await ctx.dispose();

  await register(page);
  await createList(page, 'Roma', `Arama kartı ${uniq('a')}`);
  await tid(page, 'seg-map').click();
  await tid(page, 'place-search-input').pressSequentially('eustachio', { delay: 20 });
  await tid(page, 'place-search-result').filter({ hasText: "Sant'Eustachio" }).click();
  await expect(tid(page, 'search-card-name')).toHaveText("Sant'Eustachio Il Caffè");
  await expect(tid(page, 'search-pin')).toHaveCount(1);
  await expect(tid(page, 'search-card-rating')).toBeVisible();
  await expect(tid(page, 'search-card-comment-text').first()).toHaveText(`Kahvesi efsane ${tag}`);
  await expect(tid(page, 'search-card-add')).toHaveText(/Listeye ekle/);
  const before = Number(await tid(page, 'search-card-count').innerText());
  await tid(page, 'search-card-star-3').click();
  await expect(tid(page, 'search-card-count')).toHaveText(String(before + 1));
  await tid(page, 'search-card-all-comments').click();
  await expect(page).toHaveURL(new RegExp(`/places/${pid}$`));
  await expect(tid(page, 'place-title')).toHaveText("Sant'Eustachio Il Caffè");
  await expect(tid(page, 'star-3')).toHaveAttribute('aria-checked', 'true');
  await expect(tid(page, 'comment').filter({ hasText: `Kahvesi efsane ${tag}` })).toBeVisible();
});
