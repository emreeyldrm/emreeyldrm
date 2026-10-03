import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { createList, newAccount, register, tid, uniq, userSession } from './helpers';

/** API of the server under test (playwright.config.ts metadata: NestJS 3100 or Worker 8790). */
const apiUrl = () => test.info().config.metadata.apiUrl as string;

interface ApiUser { auth: { Authorization: string } }

async function apiUser(ctx: APIRequestContext, p: string): Promise<ApiUser> {
  const res = await ctx.post('/auth/register', { data: newAccount(p) });
  expect(res.status()).toBe(201);
  return { auth: { Authorization: `Bearer ${(await res.json()).token}` } };
}

const place = (city: string, key: string, name: string, category: string, i: number) => ({
  provider: 'osm', providerId: `${city}-${key}`, name, category, city, lat: 37.03 + i / 100, lon: 27.42 + i / 100,
});

/**
 * Seeds a city: 4 users view, rate and save 4 places.
 *   trend  = views + 3×saves + 2×ratings:  Lokanta 12, Bar 9, Plaj 7, Kahve 5
 *   topRated (Bayes):                      Lokanta 4.08, Plaj 3.63, Kahve 3.38 (Bar unrated)
 *   mostSearched = views + saves:          Bar 5, Lokanta 4, Plaj 3, Kahve 1
 */
async function seedCity(city: string) {
  const ctx = await request.newContext({ baseURL: apiUrl() });
  const [owner, b, c, d] = [await apiUser(ctx, 'own'), await apiUser(ctx, 'b'), await apiUser(ctx, 'c'), await apiUser(ctx, 'd')];
  const items = [
    place(city, 'lok', 'Lokanta Usta', 'food', 1),
    place(city, 'bar', 'Gece Barı', 'bar', 2),
    place(city, 'plaj', 'Deniz Plajı', 'beach', 3),
    place(city, 'kahve', 'Köşe Kahve', 'coffee', 4),
  ];
  const title = `Hafta sonu ${city}`;
  const list = await (await ctx.post('/lists', { headers: owner.auth, data: { city, title, visibility: 'public' } })).json();
  expect((await ctx.put(`/lists/${list.id}/items`, { headers: owner.auth, data: { items } })).ok()).toBe(true);
  const detail = await (await ctx.get(`/lists/${list.id}`, { headers: owner.auth })).json();
  const id = Object.fromEntries(detail.items.map((it: { name: string; placeId: number }) => [it.name, it.placeId])) as Record<string, number>;
  const view = async (u: ApiUser, name: string) => expect((await ctx.get(`/places/${id[name]}`, { headers: u.auth })).ok()).toBe(true);
  const rate = async (u: ApiUser, name: string, stars: number) =>
    expect((await ctx.put(`/places/${id[name]}/rating`, { headers: u.auth, data: { stars } })).ok()).toBe(true);
  for (const u of [b, c, d]) { await view(u, 'Lokanta Usta'); await view(u, 'Gece Barı'); }
  for (const u of [b, c]) await view(u, 'Deniz Plajı');
  await rate(b, 'Lokanta Usta', 5); await rate(c, 'Lokanta Usta', 5); await rate(d, 'Lokanta Usta', 4);
  await rate(b, 'Deniz Plajı', 4);
  await rate(b, 'Köşe Kahve', 3);
  const bl = await (await ctx.post('/lists', { headers: b.auth, data: { city, title: 'Gidilecek' } })).json();
  expect((await ctx.put(`/lists/${bl.id}/items`, { headers: b.auth, data: { items: [items[1]] } })).ok()).toBe(true);
  await ctx.dispose();
  return { id, title };
}

async function chooseCity(page: Page, city: string) {
  await tid(page, 'discover-city').fill(city);
  await tid(page, 'discover-search').click();
  await expect(tid(page, 'sec-pow')).toBeVisible();
  await expect(tid(page, 'sec-lists')).toBeVisible();
}

const texts = (page: Page, id: string) => tid(page, id).allInnerTexts();

test('AC-MOB-26: Keşfet şehir seçici, haftanın restoranı, trendler, en çok beğenilenler (çipler), en çok aranan, popüler listeler', async ({ page }) => {
  const city = `Kesfet${uniq('k')}`;
  const { id, title } = await seedCity(city);

  // varsayılan şehir: konum izni yok, liste yok -> İstanbul
  await register(page, newAccount('dsc'));
  await page.goto('/discover');
  await expect(tid(page, 'discover-city')).toHaveValue('İstanbul');
  await expect(tid(page, 'sec-pow')).toBeVisible();

  // şehir alanı öneri gösterir (çevrimdışı veri)
  await tid(page, 'discover-city').fill('anka');
  await expect(tid(page, 'discover-city-option').first()).toContainText('Ankara');
  await tid(page, 'discover-city-option').first().click();
  await expect(tid(page, 'discover-city')).toHaveValue('Ankara');
  await expect(tid(page, 'discover-city-option')).toHaveCount(0);

  await chooseCity(page, city);
  // bölümler sırayla
  const ys: number[] = [];
  for (const s of ['sec-pow', 'sec-trending', 'sec-top', 'sec-searched', 'sec-lists']) {
    const box = await tid(page, s).boundingBox();
    expect(box).not.toBeNull();
    ys.push(box!.y);
  }
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  await expect(tid(page, 'sec-pow').getByRole('heading')).toHaveText('Haftanın restoranı');
  await expect(tid(page, 'sec-trending').getByRole('heading')).toHaveText('Haftanın trendleri');
  await expect(tid(page, 'sec-top').getByRole('heading')).toHaveText('En çok beğenilenler');
  await expect(tid(page, 'sec-searched').getByRole('heading')).toHaveText('En çok aranan');
  await expect(tid(page, 'sec-lists').getByRole('heading')).toHaveText('Popüler listeler');

  // Haftanın restoranı: büyük kart, kategori simgesi ve "4,7 · 3 puan · bu hafta 3 bakış"
  const hero = tid(page, 'pow-card');
  await expect(hero.getByTestId('pow-name')).toHaveText('Lokanta Usta');
  await expect(hero.getByTestId('pow-stats')).toHaveText('4,7 · 3 puan · bu hafta 3 bakış');
  await expect(hero.getByTestId('category-icon')).toHaveAttribute('data-category', 'food');

  // trendler: yatay kaydırmalı, trend puanına göre
  await expect(tid(page, 'trend-card')).toHaveCount(4);
  expect(await texts(page, 'trend-name')).toEqual(['Lokanta Usta', 'Gece Barı', 'Deniz Plajı', 'Köşe Kahve']);
  await expect(tid(page, 'trend-card').nth(1).getByTestId('trend-stats')).toHaveText('Henüz puan yok · bu hafta 3 bakış');
  await expect(tid(page, 'trend-card').nth(1).getByTestId('category-icon')).toHaveAttribute('data-category', 'bar');
  const [t1, t2] = [await tid(page, 'trend-card').nth(0).boundingBox(), await tid(page, 'trend-card').nth(1).boundingBox()];
  expect(t2!.x).toBeGreaterThan(t1!.x); // yan yana
  expect(t2!.y).toBe(t1!.y);
  expect(await tid(page, 'trending-list').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // en çok beğenilenler: Bayes ortalaması; sayısı 0 olan çipler gizli
  expect(await texts(page, 'top-name')).toEqual(['Lokanta Usta', 'Deniz Plajı', 'Köşe Kahve']);
  await expect(tid(page, 'top-row').first()).toContainText('4,7');
  await expect(tid(page, 'top-stats').first()).toHaveText('Yemek · 3 puan · bu hafta 3 bakış');
  await expect(tid(page, 'searched-stats').first()).toHaveText('Bar · Henüz puan yok · bu hafta 3 bakış');
  for (const k of ['all', 'food', 'coffee', 'bar', 'beach']) await expect(tid(page, `top-chip-${k}`)).toBeVisible();
  for (const k of ['museum', 'historic', 'park', 'hotel', 'airport', 'other']) await expect(tid(page, `top-chip-${k}`)).toHaveCount(0);
  await expect(tid(page, 'top-chip-all')).toHaveAttribute('aria-selected', 'true');
  await tid(page, 'top-chip-beach').click();
  await expect(tid(page, 'top-chip-beach')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => texts(page, 'top-name')).toEqual(['Deniz Plajı']);
  await tid(page, 'top-chip-bar').click();
  await expect(tid(page, 'top-empty')).toHaveText('Bar kategorisinde puanlanmış yer yok.');
  await expect(tid(page, 'top-row')).toHaveCount(0);
  await tid(page, 'top-chip-all').click();
  await expect.poll(() => texts(page, 'top-name')).toEqual(['Lokanta Usta', 'Deniz Plajı', 'Köşe Kahve']);

  // en çok aranan: bakış + kayıt
  expect(await texts(page, 'searched-name')).toEqual(['Gece Barı', 'Lokanta Usta', 'Deniz Plajı', 'Köşe Kahve']);

  // mevcut popüler listeler bölümü o şehrin herkese açık listesini gösterir
  await expect(tid(page, 'discover-card').filter({ hasText: title })).toContainText('4 yer');

  // karta dokununca yer sayfası açılır
  await tid(page, 'trend-card').nth(1).click();
  await expect(page).toHaveURL(new RegExp(`/places/${id['Gece Barı']}$`));
  await expect(tid(page, 'place-title')).toHaveText('Gece Barı');
});

test('AC-MOB-26: varsayılan şehir konuma en yakın şehir (izin verilmişse), yoksa son listenin şehri', async ({ browser, page }) => {
  // konum izni zaten verilmiş: Roma'nın merkezine yakın -> "Roma" (izin penceresi açılmaz)
  const near = await userSession(browser, 'geo', { geolocation: { latitude: 41.9, longitude: 12.49 }, permissions: ['geolocation'] });
  await near.page.goto('/discover');
  await expect(tid(near.page, 'discover-city')).toHaveValue('Roma');
  await near.ctx.close();

  // konum yok: kullanıcının en son listesinin şehri
  await register(page, newAccount('last'));
  await createList(page, 'Lizbon', `Lizbon ${uniq('t')}`);
  await page.goto('/discover');
  await expect(tid(page, 'discover-city')).toHaveValue('Lizbon');
});

test('AC-MOB-27: veri yokken bölümler bozulmaz, boş durum metinleri görünür; yenileme yeni veriyi getirir', async ({ page }) => {
  const city = `Bos${uniq('e')}`;
  await register(page, newAccount('emp'));
  await page.goto('/discover');
  await chooseCity(page, city);
  await expect(tid(page, 'pow-empty')).toBeVisible();
  await expect(tid(page, 'trending-empty')).toHaveText('Bu hafta henüz trend yok — ilk puanı sen ver');
  await expect(tid(page, 'top-empty')).toBeVisible();
  await expect(tid(page, 'top-chips')).toHaveCount(0);
  await expect(tid(page, 'searched-empty')).toBeVisible();
  await expect(tid(page, 'discover-empty')).toBeVisible();
  await expect(tid(page, 'error')).toHaveCount(0);

  // başka biri bu şehirde bir yer kaydedip puanlar; çekerek yenileme (web: "Yenile" düğmesi) yeni veriyi getirir
  await seedCity(city);
  await tid(page, 'discover-refresh').click();
  await expect(tid(page, 'trend-card')).toHaveCount(4);
  await expect(tid(page, 'pow-name')).toHaveText('Lokanta Usta');
  await expect(tid(page, 'trending-empty')).toHaveCount(0);
  await expect(tid(page, 'discover-card')).toHaveCount(1);
});
