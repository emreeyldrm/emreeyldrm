import { deflateSync } from 'node:zlib';
import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';

export const uniq = (p = 'u') =>
  `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);

export interface Account { handle: string; email: string; password: string }
export const newAccount = (p = 'u'): Account => {
  const handle = uniq(p);
  return { handle, email: `${handle}@example.com`, password: 'Passw0rd!x' };
};

/** Visible element by testID (screens kept mounted by the navigator may hold hidden duplicates). */
export const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

export async function register(page: Page, a: Account = newAccount()): Promise<Account> {
  await page.goto('/register');
  await page.getByTestId('register-email').fill(a.email);
  await page.getByTestId('register-handle').fill(a.handle);
  await page.getByTestId('register-password').fill(a.password);
  await page.getByTestId('register-submit').click();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(tid(page, 'current-handle')).toHaveText(`@${a.handle}`);
  return a;
}

export async function userSession(browser: Browser, p = 'u', opts: BrowserContextOptions = {}): Promise<{ ctx: BrowserContext; page: Page; acc: Account }> {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const acc = await register(page, newAccount(p));
  return { ctx, page, acc };
}

export async function createList(page: Page, city: string, title: string): Promise<void> {
  await page.goto('/lists');
  await expect(tid(page, 'list-new')).toBeVisible();
  if (!(await tid(page, 'list-create-form').isVisible())) await tid(page, 'list-new').click();
  await tid(page, 'list-city').fill(city);
  await tid(page, 'list-title').fill(title);
  await tid(page, 'list-create').click();
  await tid(page, 'list-card').filter({ hasText: title }).click();
  await expect(tid(page, 'list-detail-title')).toHaveText(title);
}

export type Loc = { lat: number; lon: number } | 'device' | null;

export async function addPlace(page: Page, name: string, category: string, note = '', loc: Loc = null): Promise<void> {
  await tid(page, 'place-add-open').click();
  const sheet = page.getByTestId('add-place-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('place-name').fill(name);
  await sheet.getByTestId(`place-cat-${category}`).click();
  await expect(sheet.getByTestId(`place-cat-${category}`)).toHaveAttribute('aria-checked', 'true');
  if (note) await sheet.getByTestId('place-note').fill(note);
  if (loc === 'device') {
    await sheet.getByTestId('place-use-location').click();
    await expect(sheet.getByTestId('place-coords')).toBeVisible();
  } else if (loc) {
    await sheet.getByTestId('loc-map').click();
    await sheet.getByTestId('pick-lat').fill(String(loc.lat));
    await sheet.getByTestId('pick-lon').fill(String(loc.lon));
    await expect(sheet.getByTestId('place-coords')).toBeVisible();
  }
  await sheet.getByTestId('place-add').click();
  await expect(page.getByTestId('add-place-sheet')).toHaveCount(0);
  await expect(tid(page, 'place-item').filter({ hasText: name })).toBeVisible();
}

/** Creates a list with one place and opens its place page; returns the place page path. */
export async function openNewPlace(page: Page, city: string, name: string): Promise<string> {
  await createList(page, city, `Liste ${name}`);
  await addPlace(page, name, 'food');
  await tid(page, 'place-link').filter({ hasText: name }).click();
  await expect(tid(page, 'place-title')).toHaveText(name);
  return new URL(page.url()).pathname;
}

export async function follow(page: Page, handle: string): Promise<void> {
  await page.goto('/friends');
  await tid(page, 'user-search').fill(handle);
  await tid(page, 'user-search-submit').click();
  const row = tid(page, 'search-results').getByTestId('user-row').filter({ hasText: `@${handle}` });
  await row.getByTestId('follow').click();
  await expect(row.getByTestId('unfollow')).toBeVisible();
}

const VIS_KEY: Record<string, string> = { 'Sadece ben': 'private', 'Arkadaşlar': 'friends', 'Herkes': 'public' };

export async function comment(page: Page, text: string, visLabel: string): Promise<void> {
  await tid(page, 'comment-body').fill(text);
  await tid(page, `comment-vis-${VIS_KEY[visLabel]}`).click();
  await expect(tid(page, `comment-vis-${VIS_KEY[visLabel]}`)).toHaveAttribute('aria-checked', 'true');
  await tid(page, 'comment-submit').click();
  await expect(tid(page, 'comment').filter({ hasText: text })).toBeVisible();
}

/** Records window.open calls (Linking.openURL on web) instead of opening new tabs. */
export async function stubWindowOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[]; open: (u?: string | URL) => null };
    w.__opened = [];
    w.open = (u?: string | URL) => { w.__opened.push(String(u)); return null; };
  });
}
export const openedUrls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

/** A real, solid-colour PNG (decodable by the browser's canvas, so the client can resize/re-encode it). */
export function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: width }, () => Buffer.from(rgb)))]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
