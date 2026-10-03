import { expect, test, type Locator, type Page } from '@playwright/test';
import { createList, register, tid, uniq, userSession } from './helpers';

// Plan iyileştirmeleri (PLN): yaya rotası, açılış saati rozeti, gezi bütçesi.
// Sunucular sahte sağlayıcılarla çalışır (ROUTING_PROVIDER=fake: kuş uçuşu × 1,3, 4,8 km/sa; HOURS_PROVIDER=fake:
// sağlayıcı kimliğine göre sabit opening_hours metinleri, bkz. plan-core.ts FAKE_HOURS). Saat `page.clock` ile sabitlenir.

/** Fixtures (server/src/search/search-core.ts FAKE_PLACES). */
const P = {
  colosseo: { q: 'colos', name: 'Colosseo', lat: 41.8902, lon: 12.4922 },
  roscioli: { q: 'rosciol', name: 'Roscioli Salumeria', lat: 41.8937, lon: 12.4731 },
  eustachio: { q: 'eustachio', name: "Sant'Eustachio Il Caffè", lat: 41.8986, lon: 12.4755 },
  villa: { q: 'villa borg', name: 'Villa Borghese', lat: 41.9142, lon: 12.4923 },
};
type Fixture = (typeof P)[keyof typeof P];

/** Same numbers as the fake routing provider (plan-core.ts fakeWalk) and the app's formatting. */
function fakeWalk(stops: Fixture[]) {
  const r = (d: number) => (d * Math.PI) / 180;
  const legs = stops.slice(1).map((b, i) => {
    const a = stops[i];
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
    const d = 2 * 6371000 * Math.asin(Math.sqrt(h)) * 1.3;
    return { m: Math.round(d), s: Math.round(d / (4800 / 3600)) };
  });
  return { legs, m: legs.reduce((x, l) => x + l.m, 0), s: legs.reduce((x, l) => x + l.s, 0) };
}
const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const dur = (s: number) => {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} dk` : `${Math.floor(min / 60)} sa${min % 60 ? ` ${min % 60} dk` : ''}`;
};

async function openSheet(page: Page): Promise<Locator> {
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Adds a fake-provider place from the add sheet's search suggestions, optionally with spend per person. */
async function addFromSearch(page: Page, f: Fixture, spend?: { amount: string; currency?: string }) {
  const sheet = await openSheet(page);
  await sheet.getByTestId('place-name').pressSequentially(f.q, { delay: 30 });
  await sheet.getByTestId('place-suggest-result').filter({ hasText: f.name }).click();
  await expect(sheet.getByTestId('place-name')).toHaveValue(f.name);
  if (spend) {
    if (!(await sheet.getByTestId('details-section').isVisible())) await sheet.getByTestId('details-toggle').click();
    if (spend.currency) {
      await sheet.getByTestId('spend-currency').click();
      await sheet.getByTestId(`currency-${spend.currency}`).click();
    }
    await sheet.getByTestId('spend-amount').fill(spend.amount);
  }
  await sheet.getByTestId('place-add').click();
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);
  await expect(tid(page, 'place-item').filter({ hasText: f.name })).toBeVisible();
}

async function planDay(page: Page, day: number, names: string[]) {
  const d = tid(page, `plan-day-${day}`);
  await d.getByTestId(`plan-add-${day}`).click();
  for (const n of names) await d.getByTestId('plan-pick').filter({ hasText: n }).click();
  await expect(d.getByTestId('plan-item-name')).toHaveText(names);
}

/** Roma list: day 1 = Colosseo (18 €), Roscioli (25 €), Sant'Eustachio (no spend); day 2 = Villa Borghese (10 $). */
async function romaPlan(page: Page): Promise<void> {
  await createList(page, 'Roma', `Gezi ${uniq('r')}`);
  await addFromSearch(page, P.colosseo, { amount: '18' });
  await addFromSearch(page, P.roscioli, { amount: '25' });
  await addFromSearch(page, P.eustachio);
  await addFromSearch(page, P.villa, { amount: '10', currency: 'USD' });
  await tid(page, 'seg-plan').click();
  await planDay(page, 1, [P.colosseo.name, P.roscioli.name, P.eustachio.name]);
  await planDay(page, 2, [P.villa.name]);
}

// Pazartesi 5 Ekim 2026, Roma yaz saati (UTC+2).
const ROME = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00+02:00`);

test('AC-MOB-43 / AC-MOB-45: plan gününde duraklar arası yürüme süresi, günün toplamı; günlük ve toplam bütçe', async ({ page }) => {
  await page.clock.setFixedTime(ROME('20:00'));
  await register(page);
  await romaPlan(page);

  const day1 = tid(page, 'plan-day-1');
  const walk = fakeWalk([P.colosseo, P.roscioli, P.eustachio]);
  await expect(tid(page, 'plan-summary-1')).toHaveText(`3 durak · ${km(walk.m)} · ${dur(walk.s)} yürüyüş`);
  await expect(day1.getByTestId('plan-leg')).toHaveText(walk.legs.map((l) => `${dur(l.s)} · ${km(l.m)}`));
  await expect(tid(page, 'plan-summary-2')).toHaveText('1 durak');
  await expect(tid(page, 'plan-day-2').getByTestId('plan-leg')).toHaveCount(0);

  // durak rozetleri (AC-MOB-44 plan durağında): Roscioli 19:00-23:00, Sant'Eustachio 07:30-01:00, Villa 24/7
  await expect(day1.getByTestId('plan-item').filter({ hasText: P.roscioli.name }).getByTestId('plan-item-hours')).toHaveText("Açık · 23:00'te kapanır");
  await expect(day1.getByTestId('plan-item').filter({ hasText: P.eustachio.name }).getByTestId('plan-item-hours')).toHaveText("Açık · 01:00'de kapanır");
  await expect(day1.getByTestId('plan-item').filter({ hasText: P.colosseo.name }).getByTestId('plan-item-hours')).toHaveText("Kapalı · yarın 08:30'da açılır");
  await expect(tid(page, 'plan-day-2').getByTestId('plan-item-hours')).toHaveText('24 saat açık');

  // bütçe (AC-MOB-45): para birimine göre ayrı, harcaması olmayan yer sayısı
  await expect(tid(page, 'plan-budget-1')).toHaveText('Bütçe ~43 € · 1 yerin harcaması yok');
  await expect(tid(page, 'plan-budget-2')).toHaveText('Bütçe ~10 $');
  await expect(tid(page, 'plan-budget-3')).toHaveCount(0);
  await expect(tid(page, 'plan-budget-total-amount')).toHaveText('~43 € + ~10 $');
  await expect(tid(page, 'plan-budget-total-missing')).toContainText('1 yerin harcaması yok');

  if (process.env.PLAN_SHOT) {
    await tid(page, 'plan-day-1').scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.PLAN_SHOT });
  }

  // gün haritası: aynı yürüme süreleri ve bütçe
  await tid(page, 'plan-daymap-1').click();
  await expect(tid(page, 'day-summary')).toHaveText(`3 durak · ${km(walk.m)} · ${dur(walk.s)} yürüyüş`);
  await expect(tid(page, 'day-stop-leg')).toHaveText(['Tarihi', ...walk.legs.map((l) => `${dur(l.s)} · ${km(l.m)}`)]);
  await expect(tid(page, 'day-budget')).toHaveText('Bütçe ~43 € · 1 yerin harcaması yok');
  await expect(tid(page, 'day-stop-hours')).toHaveText(["Kapalı · yarın 08:30'da açılır", "Açık · 23:00'te kapanır", "Açık · 01:00'de kapanır"]);
  await tid(page, 'back').click();

  // Sıra değişince rota yeniden alınır
  await day1.getByTestId('plan-item').filter({ hasText: P.eustachio.name }).getByTestId('plan-up').click();
  const walk2 = fakeWalk([P.colosseo, P.eustachio, P.roscioli]);
  await expect(tid(page, 'plan-summary-1')).toHaveText(`3 durak · ${km(walk2.m)} · ${dur(walk2.s)} yürüyüş`);

  // Sunucuya ulaşılamadan yeniden açılış: aynı günün rotası cihazdaki önbellekten gelir; yeni sıra (önbellekte yok)
  // kuş uçuşuna düşer.
  const apiUrl = String(test.info().config.metadata.apiUrl);
  await page.context().route(`${apiUrl}/**`, (r) => r.abort('internetdisconnected'));
  await page.reload();
  await expect(tid(page, 'offline-banner')).toBeVisible();
  await expect(tid(page, 'plan-summary-1')).toHaveText(`3 durak · ${km(walk2.m)} · ${dur(walk2.s)} yürüyüş`);
  await tid(page, 'plan-day-1').getByTestId('plan-item').filter({ hasText: P.colosseo.name }).getByTestId('plan-down').click();
  await expect(tid(page, 'plan-day-1').getByTestId('plan-item-name')).toHaveText([P.eustachio.name, P.colosseo.name, P.roscioli.name]);
  await expect(tid(page, 'plan-summary-1')).toHaveText(/^3 durak · [\d,]+ km · kuş uçuşu$/);
  await page.context().unroute(`${apiUrl}/**`);
});

test('AC-MOB-43: rota alınamazsa kuş uçuşu mesafe gösterilir', async ({ page }) => {
  await register(page);
  await createList(page, 'Roma', `Kuş ${uniq('k')}`);
  await addFromSearch(page, P.colosseo);
  await addFromSearch(page, P.roscioli);
  // Rota sağlayıcısı hata verir (502).
  await page.route('**/routes/walk?**', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"Rota sağlayıcısı yanıt vermedi"}' }));
  await tid(page, 'seg-plan').click();
  await planDay(page, 1, [P.colosseo.name, P.roscioli.name]);
  const straight = fakeWalk([P.colosseo, P.roscioli]).m / 1.3;
  await expect(tid(page, 'plan-summary-1')).toHaveText(`2 durak · ${km(straight)} · kuş uçuşu`);
  await expect(tid(page, 'plan-day-1').getByTestId('plan-leg')).toHaveText([`${km(straight)} kuş uçuşu`]);
  await expect(tid(page, 'plan-straight-1')).toHaveCount(0);
});

test('AC-MOB-44: yer sayfasında açılış rozeti yerin saat dilimine göre (Açık / Kapanmasına / Kapalı); saat yoksa rozet yok', async ({ browser }) => {
  // Cihaz Tokyo saatinde; rozet yerin (Roma) saatine göre hesaplanır.
  const { ctx, page } = await userSession(browser, 'h', { timezoneId: 'Asia/Tokyo' });
  await page.clock.setFixedTime(ROME('20:00'));
  await createList(page, 'Roma', `Saat ${uniq('s')}`);
  await addFromSearch(page, P.roscioli);
  await tid(page, 'place-link').filter({ hasText: P.roscioli.name }).click();
  await expect(tid(page, 'place-title')).toHaveText(P.roscioli.name);
  const badge = tid(page, 'place-open-badge');
  await expect(badge).toHaveText("Açık · 23:00'te kapanır");
  await expect(tid(page, 'place-open-badge-device-time')).toHaveCount(0);

  await page.clock.setFixedTime(ROME('22:30'));
  await page.reload();
  await expect(badge).toHaveText('Kapanmasına 30 dk');

  await page.clock.setFixedTime(ROME('08:00'));
  await page.reload();
  await expect(badge).toHaveText("Kapalı · 12:30'da açılır");

  // Pazar: kapalı, pazartesi açılır
  await page.clock.setFixedTime(new Date('2026-10-04T12:00:00+02:00'));
  await page.reload();
  await expect(badge).toHaveText("Kapalı · yarın 12:30'da açılır");

  // Saati bilinmeyen (elle eklenmiş) yer: rozet yok
  await page.goto('/lists');
  await tid(page, 'list-card').first().click();
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  await sheet.getByTestId('place-name').fill('Ev Yemekleri');
  await sheet.getByTestId('place-add').click();
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);
  await tid(page, 'place-link').filter({ hasText: 'Ev Yemekleri' }).click();
  await expect(tid(page, 'place-title')).toHaveText('Ev Yemekleri');
  await expect(tid(page, 'rating-count')).toBeVisible();
  await expect(tid(page, 'place-open-badge')).toHaveCount(0);
  await ctx.close();
});
