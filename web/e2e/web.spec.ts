import { test, expect } from '@playwright/test';
import { addPlace, comment, createList, follow, newAccount, openNewPlace, register, uniq, userSession } from './helpers';

test('AC-WEB-1: kayıt/giriş formları, hata mesajları, çıkış ve oturumun yenilemede korunması', async ({ page, browser }) => {
  const a = await register(page);
  await expect(page.getByTestId('current-handle')).toHaveText(`@${a.handle}`);

  // oturum yenilemeden sonra korunur
  await page.reload();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(page.getByTestId('current-handle')).toHaveText(`@${a.handle}`);

  // çıkış
  await page.goto('/profile');
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login$/);

  // yanlış parola hatası
  await page.getByTestId('login-email').fill(a.email);
  await page.getByTestId('login-password').fill('yanlis-parola-1');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('error')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  // doğru parola ile giriş
  await page.getByTestId('login-password').fill(a.password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/lists$/);

  // çakışma hatası (aynı e-posta/handle), ayrı bağlamda
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto('/register');
  await p2.getByTestId('register-email').fill(a.email);
  await p2.getByTestId('register-handle').fill(a.handle);
  await p2.getByTestId('register-password').fill(a.password);
  await p2.getByTestId('register-submit').click();
  await expect(p2.getByTestId('error')).toBeVisible();
  await expect(p2).toHaveURL(/\/register$/);
  await ctx.close();
});

test('AC-WEB-2: giriş yapmayan kullanıcı korumalı sayfalarda giriş sayfasına yönlenir', async ({ page }) => {
  for (const path of ['/lists', '/lists/1', '/discover', '/places/1', '/friends', '/profile']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-form')).toBeVisible();
  }
});

test('AC-WEB-3: liste oluşturma, yer ekleme, kategori filtresi ve kategori simge/renkleri', async ({ page }) => {
  await register(page);
  const title = `Gezi ${uniq('t')}`;
  await createList(page, 'İstanbul', title);
  await addPlace(page, 'Kahve Durağı', 'coffee', 'sütlü filtre kahve');
  await addPlace(page, 'Ayasofya', 'historic');
  await addPlace(page, 'Balıkçı', 'food');
  await expect(page.getByTestId('place-item')).toHaveCount(3);
  await expect(page.getByTestId('place-item').filter({ hasText: 'Kahve Durağı' }).getByTestId('place-item-note')).toHaveText('sütlü filtre kahve');

  // kategori simge ve renkleri
  const coffeeIcon = page.getByTestId('place-item').filter({ hasText: 'Kahve Durağı' }).getByTestId('category-icon');
  await expect(coffeeIcon).toHaveAttribute('data-category', 'coffee');
  await expect(coffeeIcon).toHaveCSS('background-color', 'rgb(244, 236, 230)');
  await expect(coffeeIcon).toHaveCSS('color', 'rgb(140, 92, 56)');
  await expect(coffeeIcon.locator('svg')).toBeVisible();
  const histIcon = page.getByTestId('place-item').filter({ hasText: 'Ayasofya' }).getByTestId('category-icon');
  await expect(histIcon).toHaveCSS('color', 'rgb(46, 125, 91)');

  // filtre
  await page.getByTestId('filter-coffee').click();
  await expect(page.getByTestId('place-item')).toHaveCount(1);
  await expect(page.getByTestId('place-item')).toContainText('Kahve Durağı');
  await page.getByTestId('filter-all').click();
  await expect(page.getByTestId('place-item')).toHaveCount(3);

  // kalıcılık: yenileyince 3 yer hâlâ var ve liste kartı sayıyı gösterir
  await page.reload();
  await expect(page.getByTestId('place-item')).toHaveCount(3);
  await page.goto('/lists');
  await expect(page.getByTestId('list-card').filter({ hasText: title })).toContainText('3 yer');
});

test('AC-WEB-4: liste herkese açık yapılır; başka kullanıcı Keşfet\'te şehir araması ile bulur ve açar', async ({ page, browser }) => {
  await register(page, newAccount('own'));
  const city = `Şehir${uniq('c')}`;
  const title = `Açık liste ${uniq('t')}`;
  await createList(page, city, title);
  await addPlace(page, 'Herkesin Yeri', 'park');

  const other = await userSession(browser, 'vis');
  await other.page.goto('/discover');
  await other.page.getByTestId('discover-city').fill(city);
  await other.page.getByTestId('discover-search').click();
  await expect(other.page.getByTestId('discover-empty')).toBeVisible(); // henüz özel

  await page.getByTestId('visibility-public').click();
  await expect(page.getByTestId('visibility-public')).toHaveAttribute('aria-pressed', 'true');

  await other.page.getByTestId('discover-search').click();
  const card = other.page.getByTestId('discover-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText('1 yer');
  await card.click();
  await expect(other.page.getByTestId('list-detail-title')).toHaveText(title);
  await expect(other.page.getByTestId('place-item')).toContainText('Herkesin Yeri');
  await expect(other.page.getByTestId('place-add')).toHaveCount(0); // salt okunur
  await other.ctx.close();
});

test('AC-WEB-5: yer sayfasında 1-5 yıldız verilir, ortalama ve adet güncellenir', async ({ page, browser }) => {
  await register(page);
  const name = `Puan ${uniq('p')}`;
  const path = await openNewPlace(page, 'Ankara', name);
  await expect(page.getByTestId('rating-count')).toHaveText('0');
  await page.getByTestId('star-4').click();
  await expect(page.getByTestId('rating-count')).toHaveText('1');
  await expect(page.getByTestId('rating-avg')).toHaveText('4.0');
  // tekrar puanlama sayıyı artırmaz
  await page.getByTestId('star-2').click();
  await expect(page.getByTestId('rating-avg')).toHaveText('2.0');
  await expect(page.getByTestId('rating-count')).toHaveText('1');

  // ikinci kullanıcı puanlayınca ortalama değişir
  const o = await userSession(browser, 'rtr');
  await o.page.goto(path);
  await o.page.getByTestId('star-5').click();
  await expect(o.page.getByTestId('rating-count')).toHaveText('2');
  await expect(o.page.getByTestId('rating-avg')).toHaveText('3.5');
  await o.ctx.close();
});

test('AC-WEB-6: yorum görünürlük seçici ve rozeti; arkadaş olmayan "Arkadaşlar" yorumunu görmez, arkadaş olunca görür', async ({ page, browser }) => {
  const a = await register(page, newAccount('wa'));
  const path = await openNewPlace(page, 'İzmir', `Yorum ${uniq('y')}`);
  await expect(page.getByTestId('comment-visibility').locator('option')).toHaveText(['Sadece ben', 'Arkadaşlar', 'Herkes']);

  await comment(page, 'sadece-ben-yorumu', 'Sadece ben');
  await comment(page, 'arkadaslar-yorumu', 'Arkadaşlar');
  await comment(page, 'herkes-yorumu', 'Herkes');
  await expect(page.getByTestId('comment').filter({ hasText: 'sadece-ben-yorumu' }).getByTestId('comment-badge')).toHaveText('Sadece ben');
  await expect(page.getByTestId('comment').filter({ hasText: 'arkadaslar-yorumu' }).getByTestId('comment-badge')).toHaveText('Arkadaşlar');
  await expect(page.getByTestId('comment').filter({ hasText: 'herkes-yorumu' }).getByTestId('comment-badge')).toHaveText('Herkes');

  const b = await userSession(browser, 'wb');
  await b.page.goto(path);
  await expect(b.page.getByTestId('comment').filter({ hasText: 'herkes-yorumu' })).toBeVisible();
  await expect(b.page.getByTestId('comment').filter({ hasText: 'arkadaslar-yorumu' })).toHaveCount(0);
  await expect(b.page.getByTestId('comment').filter({ hasText: 'sadece-ben-yorumu' })).toHaveCount(0);

  // tek yönlü takip yetmez
  await follow(b.page, a.handle);
  await b.page.goto(path);
  await expect(b.page.getByTestId('comment').filter({ hasText: 'herkes-yorumu' })).toBeVisible();
  await expect(b.page.getByTestId('comment').filter({ hasText: 'arkadaslar-yorumu' })).toHaveCount(0);

  // karşılıklı takip -> görür
  await follow(page, b.acc.handle);
  await b.page.goto(path);
  await expect(b.page.getByTestId('comment').filter({ hasText: 'arkadaslar-yorumu' })).toBeVisible();
  await expect(b.page.getByTestId('comment').filter({ hasText: 'sadece-ben-yorumu' })).toHaveCount(0);
  await b.ctx.close();
});

test('AC-WEB-7: kullanıcı aranır, takip edilir; karşılıklı olunca "Arkadaş" etiketi çıkar', async ({ page, browser }) => {
  const a = await register(page, newAccount('fa'));
  const b = await userSession(browser, 'fb');

  await b.page.goto('/friends');
  await b.page.getByTestId('user-search').fill(a.handle);
  await b.page.getByTestId('user-search-submit').click();
  const rowB = b.page.getByTestId('search-results').getByTestId('user-row').filter({ hasText: `@${a.handle}` });
  await expect(rowB).toBeVisible();
  await expect(rowB.getByTestId('friend-badge')).toHaveCount(0);
  await rowB.getByTestId('follow').click();
  await expect(rowB.getByTestId('unfollow')).toBeVisible();
  await expect(rowB.getByTestId('friend-badge')).toHaveCount(0); // tek yönlü
  await expect(b.page.getByTestId('following-list')).toContainText(`@${a.handle}`);

  await follow(page, b.acc.handle); // a, b'yi takip eder
  await expect(page.getByTestId('search-results').getByTestId('user-row').filter({ hasText: `@${b.acc.handle}` }).getByTestId('friend-badge')).toHaveText('Arkadaş');
  await expect(page.getByTestId('following-list').getByTestId('user-row').filter({ hasText: `@${b.acc.handle}` }).getByTestId('friend-badge')).toBeVisible();

  // takibi bırakınca etiket kaybolur
  await page.getByTestId('following-list').getByTestId('user-row').filter({ hasText: `@${b.acc.handle}` }).getByTestId('unfollow').click();
  await expect(page.getByTestId('following-empty')).toBeVisible();
  await b.ctx.close();
});

test('AC-WEB-8: yorumdan "Şikayet et" ve "Engelle"; engellenen kullanıcının yorumu kaybolur', async ({ page, browser }) => {
  await register(page, newAccount('ra'));
  const path = await openNewPlace(page, 'Bursa', `Engel ${uniq('e')}`);
  await comment(page, 'rahatsiz-edici-yorum', 'Herkes');

  const b = await userSession(browser, 'rb');
  await b.page.goto(path);
  const c = b.page.getByTestId('comment').filter({ hasText: 'rahatsiz-edici-yorum' });
  await expect(c).toBeVisible();

  // kendi yorumunda "Sil" var, başkasında Şikayet/Engelle
  await c.getByTestId('comment-menu').click();
  await expect(b.page.getByRole('menuitem', { name: 'Şikayet et' })).toBeVisible();
  await expect(b.page.getByRole('menuitem', { name: 'Engelle' })).toBeVisible();
  await expect(b.page.getByRole('menuitem', { name: 'Sil' })).toHaveCount(0);
  await b.page.getByRole('menuitem', { name: 'Şikayet et' }).click();
  await expect(b.page.getByTestId('info')).toContainText('Şikayet');

  await c.getByTestId('comment-menu').click();
  await b.page.getByRole('menuitem', { name: 'Engelle' }).click();
  await expect(b.page.getByTestId('comment').filter({ hasText: 'rahatsiz-edici-yorum' })).toHaveCount(0);
  await b.page.reload();
  await expect(b.page.getByTestId('comments-empty')).toBeVisible();

  // yazan kendi yorumunda Sil görür
  await page.reload();
  await page.getByTestId('comment').first().getByTestId('comment-menu').click();
  await expect(page.getByRole('menuitem', { name: 'Sil' })).toBeVisible();
  await b.ctx.close();
});

test('AC-WEB-9: hesap silme onay penceresiyle çalışır ve kullanıcıyı giriş sayfasına döndürür', async ({ page }) => {
  const a = await register(page);
  await page.goto('/profile');
  await expect(page.getByTestId('profile-handle')).toHaveText(`@${a.handle}`);
  await expect(page.getByTestId('profile-email')).toHaveText(a.email);

  await page.getByTestId('delete-account').click();
  await expect(page.getByTestId('delete-dialog')).toBeVisible();
  await page.getByTestId('delete-cancel').click(); // vazgeç: hesap duruyor
  await expect(page.getByTestId('delete-dialog')).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByTestId('delete-account').click();
  await page.getByTestId('delete-confirm').click();
  await expect(page).toHaveURL(/\/login$/);

  // eski bilgilerle giriş artık çalışmaz
  await page.getByTestId('login-email').fill(a.email);
  await page.getByTestId('login-password').fill(a.password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('error')).toBeVisible();
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login$/);
});

test('AC-WEB-3: liste silinebilir', async ({ page }) => {
  await register(page);
  const title = `Sil ${uniq('s')}`;
  await createList(page, 'Konya', title);
  await addPlace(page, 'Mevlana', 'museum');
  await page.getByTestId('list-delete').click();
  await page.getByTestId('list-delete-confirm').click();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(page.getByTestId('list-card').filter({ hasText: title })).toHaveCount(0);
});
