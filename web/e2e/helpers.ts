import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const uniq = (p = 'u') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);

export interface Account { handle: string; email: string; password: string }
export const newAccount = (p = 'u'): Account => {
  const handle = uniq(p);
  return { handle, email: `${handle}@example.com`, password: 'Passw0rd!x' };
};

export async function register(page: Page, a: Account = newAccount()): Promise<Account> {
  await page.goto('/register');
  await page.getByTestId('register-email').fill(a.email);
  await page.getByTestId('register-handle').fill(a.handle);
  await page.getByTestId('register-password').fill(a.password);
  await page.getByTestId('register-submit').click();
  await expect(page).toHaveURL(/\/lists$/);
  return a;
}

export async function userSession(browser: Browser, p = 'u'): Promise<{ ctx: BrowserContext; page: Page; acc: Account }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const acc = await register(page, newAccount(p));
  return { ctx, page, acc };
}

export async function createList(page: Page, city: string, title: string): Promise<void> {
  await page.goto('/lists');
  await page.getByTestId('list-city').fill(city);
  await page.getByTestId('list-title').fill(title);
  await page.getByTestId('list-create').click();
  await page.getByTestId('list-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('list-detail-title')).toHaveText(title);
}

export async function addPlace(page: Page, name: string, category: string, note = ''): Promise<void> {
  await page.getByTestId('place-name').fill(name);
  await page.getByTestId('place-category').selectOption(category);
  await page.getByTestId('place-note').fill(note);
  await page.getByTestId('place-add').click();
  await expect(page.getByTestId('place-item').filter({ hasText: name })).toBeVisible();
}

/** Creates a list with one place and opens its place page; returns the place page path. */
export async function openNewPlace(page: Page, city: string, name: string): Promise<string> {
  await createList(page, city, `Liste ${name}`);
  await addPlace(page, name, 'food');
  await page.getByTestId('place-link').filter({ hasText: name }).click();
  await expect(page.getByTestId('place-title')).toHaveText(name);
  return new URL(page.url()).pathname;
}

export async function follow(page: Page, handle: string): Promise<void> {
  await page.goto('/friends');
  await page.getByTestId('user-search').fill(handle);
  await page.getByTestId('user-search-submit').click();
  const row = page.getByTestId('search-results').getByTestId('user-row').filter({ hasText: `@${handle}` });
  await row.getByTestId('follow').click();
  await expect(row.getByTestId('unfollow')).toBeVisible();
}

export async function comment(page: Page, text: string, visLabel: string): Promise<void> {
  await page.getByTestId('comment-body').fill(text);
  await page.getByTestId('comment-visibility').selectOption({ label: visLabel });
  await page.getByTestId('comment-submit').click();
  await expect(page.getByTestId('comment').filter({ hasText: text })).toBeVisible();
}
