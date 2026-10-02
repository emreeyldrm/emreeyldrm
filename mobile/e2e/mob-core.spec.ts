import { expect, test } from '@playwright/test';
import { addPlace, comment, createList, follow, newAccount, openNewPlace, register, tid, uniq, userSession } from './helpers';

test('AC-MOB-1: kayıt/giriş formları, hata mesajları, çıkış ve oturumun yenilemede korunması', async ({ page, browser }) => {
  const a = await register(page);

  // oturum yenilemeden sonra korunur
  await page.reload();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(tid(page, 'current-handle')).toHaveText(`@${a.handle}`);

  // çıkış (Profil sekmesinden)
  await tid(page, 'tab-profile').click();
  await expect(page).toHaveURL(/\/profile$/);
  await tid(page, 'logout').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
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
  await expect(tid(page, 'current-handle')).toHaveText(`@${a.handle}`);

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

test('AC-MOB-2: giriş yapmayan kullanıcı korumalı ekranlarda giriş ekranına yönlenir', async ({ page }) => {
  for (const path of ['/lists', '/lists/1', '/lists/1/share', '/lists/1/day/1', '/discover', '/messages', '/places/1', '/friends', '/profile', '/']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-form')).toBeVisible();
  }
});

test('AC-MOB-3: Listelerim\'de liste oluşturma, yer ekleme (ad/kategori/not), kategori filtresi, simge ve renkler', async ({ page }) => {
  await register(page);
  const title = `Gezi ${uniq('t')}`;
  await createList(page, 'İstanbul', title);
  await addPlace(page, 'Kahve Durağı', 'coffee', 'sütlü filtre kahve');
  await addPlace(page, 'Ayasofya', 'historic');
  await addPlace(page, 'Balıkçı', 'food');
  await expect(tid(page, 'place-item')).toHaveCount(3);
  await expect(tid(page, 'place-item').filter({ hasText: 'Kahve Durağı' }).getByTestId('place-item-note')).toHaveText('sütlü filtre kahve');

  // kategori simge ve renkleri: açık ton zemin + koyu ton simge
  const coffeeIcon = tid(page, 'place-item').filter({ hasText: 'Kahve Durağı' }).getByTestId('category-icon');
  await expect(coffeeIcon).toHaveAttribute('data-category', 'coffee');
  await expect(coffeeIcon).toHaveAttribute('aria-label', 'Kahve');
  await expect(coffeeIcon).toHaveCSS('background-color', 'rgb(244, 236, 230)');
  await expect(coffeeIcon.locator('svg path').first()).toHaveAttribute('stroke', '#8C5C38');
  const histIcon = tid(page, 'place-item').filter({ hasText: 'Ayasofya' }).getByTestId('category-icon');
  await expect(histIcon).toHaveCSS('background-color', 'rgb(230, 245, 235)');
  await expect(histIcon.locator('svg path').first()).toHaveAttribute('stroke', '#2E7D5B');

  // filtre çipleri (tint zemin + koyu yazı)
  await expect(tid(page, 'filter-coffee')).toHaveCSS('background-color', 'rgb(244, 236, 230)');
  await tid(page, 'filter-coffee').click();
  await expect(tid(page, 'place-item')).toHaveCount(1);
  await expect(tid(page, 'place-item')).toContainText('Kahve Durağı');
  await expect(tid(page, 'filter-coffee')).toHaveCSS('background-color', 'rgb(140, 92, 56)');
  await tid(page, 'filter-all').click();
  await expect(tid(page, 'place-item')).toHaveCount(3);

  // kalıcılık
  await page.reload();
  await expect(tid(page, 'place-item')).toHaveCount(3);
  await page.goto('/lists');
  await expect(tid(page, 'list-card').filter({ hasText: title })).toContainText('3 yer');

  // yer çıkarma ve liste silme
  await tid(page, 'list-card').filter({ hasText: title }).click();
  await tid(page, 'place-item').filter({ hasText: 'Balıkçı' }).getByTestId('place-remove').click();
  await expect(tid(page, 'place-item')).toHaveCount(2);
  await tid(page, 'list-delete').click();
  await page.getByTestId('list-delete-confirm').click();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(tid(page, 'list-card').filter({ hasText: title })).toHaveCount(0);
});

test('AC-MOB-4: liste "Herkese açık" yapılır; başka kullanıcı Keşfet\'te şehir araması ile bulur ve açar', async ({ page, browser }) => {
  await register(page, newAccount('own'));
  const city = `Şehir${uniq('c')}`;
  const title = `Açık liste ${uniq('t')}`;
  await createList(page, city, title);
  await addPlace(page, 'Herkesin Yeri', 'park');

  const other = await userSession(browser, 'vis');
  await other.page.goto('/discover');
  await tid(other.page, 'discover-city').fill(city);
  await tid(other.page, 'discover-search').click();
  await expect(tid(other.page, 'discover-empty')).toBeVisible(); // henüz özel

  // paylaşım ekranı: Özel / Arkadaşlar (Yakında, devre dışı) / Herkese açık
  await tid(page, 'list-share').click();
  await expect(page).toHaveURL(/\/share$/);
  await expect(tid(page, 'visibility-private')).toHaveAttribute('aria-checked', 'true');
  await expect(tid(page, 'visibility-friends')).toHaveAttribute('aria-disabled', 'true');
  await expect(tid(page, 'visibility-friends')).toContainText('Yakında');
  await tid(page, 'visibility-public').click();
  await expect(tid(page, 'visibility-public')).toHaveAttribute('aria-checked', 'true');
  await tid(page, 'share-done').click();
  await expect(tid(page, 'list-detail-visibility')).toHaveText('Herkese açık');

  await tid(other.page, 'discover-search').click();
  const card = tid(other.page, 'discover-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText('1 yer');
  await card.click();
  await expect(tid(other.page, 'list-detail-title')).toHaveText(title);
  await expect(tid(other.page, 'place-item')).toContainText('Herkesin Yeri');
  await expect(tid(other.page, 'place-add-open')).toHaveCount(0); // salt okunur
  await expect(tid(other.page, 'list-share')).toHaveCount(0);

  // tekrar özel yapılınca Keşfet'ten kaybolur
  await tid(page, 'list-share').click();
  await tid(page, 'visibility-private').click();
  await expect(tid(page, 'visibility-private')).toHaveAttribute('aria-checked', 'true');
  await other.page.goto('/discover');
  await tid(other.page, 'discover-city').fill(city);
  await tid(other.page, 'discover-search').click();
  await expect(tid(other.page, 'discover-empty')).toBeVisible();
  await other.ctx.close();
});

test('AC-MOB-5: yer ekranında 1-5 yıldız verilir, ortalama ve adet güncellenir', async ({ page, browser }) => {
  await register(page);
  const name = `Puan ${uniq('p')}`;
  const path = await openNewPlace(page, 'Ankara', name);
  await expect(tid(page, 'rating-count')).toHaveText('0');
  await expect(tid(page, 'rating-avg')).toHaveText('–');
  await tid(page, 'star-4').click();
  await expect(tid(page, 'rating-count')).toHaveText('1');
  await expect(tid(page, 'rating-avg')).toHaveText('4,0');
  await expect(tid(page, 'star-4')).toHaveAttribute('aria-checked', 'true');
  // tekrar puanlama sayıyı artırmaz
  await tid(page, 'star-2').click();
  await expect(tid(page, 'rating-avg')).toHaveText('2,0');
  await expect(tid(page, 'rating-count')).toHaveText('1');

  const o = await userSession(browser, 'rtr');
  await o.page.goto(path);
  await tid(o.page, 'star-5').click();
  await expect(tid(o.page, 'rating-count')).toHaveText('2');
  await expect(tid(o.page, 'rating-avg')).toHaveText('3,5');
  await o.ctx.close();
});

test('AC-MOB-6: yorum görünürlük seçici ve rozeti; arkadaş olmayan "Arkadaşlar" yorumunu görmez, arkadaş olunca görür', async ({ page, browser }) => {
  const a = await register(page, newAccount('wa'));
  const path = await openNewPlace(page, 'İzmir', `Yorum ${uniq('y')}`);
  await expect(tid(page, 'comment-visibility').getByRole('radio')).toHaveText(['Sadece ben', 'Arkadaşlar', 'Herkes']);
  await expect(tid(page, 'comment-vis-public')).toHaveAttribute('aria-checked', 'true'); // varsayılan Herkes

  await comment(page, 'sadece-ben-yorumu', 'Sadece ben');
  await comment(page, 'arkadaslar-yorumu', 'Arkadaşlar');
  await comment(page, 'herkes-yorumu', 'Herkes');
  await expect(tid(page, 'comment').filter({ hasText: 'sadece-ben-yorumu' }).getByTestId('comment-badge')).toHaveText('Sadece ben');
  await expect(tid(page, 'comment').filter({ hasText: 'arkadaslar-yorumu' }).getByTestId('comment-badge')).toHaveText('Arkadaşlar');
  await expect(tid(page, 'comment').filter({ hasText: 'herkes-yorumu' }).getByTestId('comment-badge')).toHaveText('Herkes');

  const b = await userSession(browser, 'wb');
  await b.page.goto(path);
  await expect(tid(b.page, 'comment').filter({ hasText: 'herkes-yorumu' })).toBeVisible();
  await expect(tid(b.page, 'comment').filter({ hasText: 'arkadaslar-yorumu' })).toHaveCount(0);
  await expect(tid(b.page, 'comment').filter({ hasText: 'sadece-ben-yorumu' })).toHaveCount(0);

  // tek yönlü takip yetmez
  await follow(b.page, a.handle);
  await b.page.goto(path);
  await expect(tid(b.page, 'comment').filter({ hasText: 'herkes-yorumu' })).toBeVisible();
  await expect(tid(b.page, 'comment').filter({ hasText: 'arkadaslar-yorumu' })).toHaveCount(0);

  // karşılıklı takip -> görür
  await follow(page, b.acc.handle);
  await b.page.goto(path);
  await expect(tid(b.page, 'comment').filter({ hasText: 'arkadaslar-yorumu' })).toBeVisible();
  await expect(tid(b.page, 'comment').filter({ hasText: 'sadece-ben-yorumu' })).toHaveCount(0);
  await b.ctx.close();
});

test('AC-MOB-7: kullanıcı aranır, takip edilir; karşılıklı olunca "Arkadaş" etiketi çıkar', async ({ page, browser }) => {
  const a = await register(page, newAccount('fa'));
  const b = await userSession(browser, 'fb');

  // Profil -> Arkadaşlar
  await tid(b.page, 'tab-profile').click();
  await tid(b.page, 'profile-friends').click();
  await expect(b.page).toHaveURL(/\/friends$/);
  await tid(b.page, 'user-search').fill(a.handle);
  await tid(b.page, 'user-search-submit').click();
  const rowB = tid(b.page, 'search-results').getByTestId('user-row').filter({ hasText: `@${a.handle}` });
  await expect(rowB).toBeVisible();
  await expect(rowB.getByTestId('friend-badge')).toHaveCount(0);
  await rowB.getByTestId('follow').click();
  await expect(rowB.getByTestId('unfollow')).toBeVisible();
  await expect(rowB.getByTestId('friend-badge')).toHaveCount(0); // tek yönlü
  await expect(tid(b.page, 'following-list')).toContainText(`@${a.handle}`);

  await follow(page, b.acc.handle);
  await expect(tid(page, 'search-results').getByTestId('user-row').filter({ hasText: `@${b.acc.handle}` }).getByTestId('friend-badge')).toHaveText('Arkadaş');
  await expect(tid(page, 'following-list').getByTestId('user-row').filter({ hasText: `@${b.acc.handle}` }).getByTestId('friend-badge')).toBeVisible();

  // takibi bırakınca etiket kaybolur
  await tid(page, 'following-list').getByTestId('user-row').filter({ hasText: `@${b.acc.handle}` }).getByTestId('unfollow').click();
  await expect(tid(page, 'following-empty')).toBeVisible();
  await expect(tid(page, 'search-results').getByTestId('user-row').filter({ hasText: `@${b.acc.handle}` }).getByTestId('friend-badge')).toHaveCount(0);
  await b.ctx.close();
});

test('AC-MOB-8: yorumdan "Şikayet et" ve "Engelle"; engellenen kullanıcının yorumu kaybolur', async ({ page, browser }) => {
  await register(page, newAccount('ra'));
  const path = await openNewPlace(page, 'Bursa', `Engel ${uniq('e')}`);
  await comment(page, 'rahatsiz-edici-yorum', 'Herkes');

  const b = await userSession(browser, 'rb');
  await b.page.goto(path);
  const c = tid(b.page, 'comment').filter({ hasText: 'rahatsiz-edici-yorum' });
  await expect(c).toBeVisible();

  // başkasının yorumunda Şikayet/Engelle var, Sil yok
  await c.getByTestId('comment-menu').click();
  await expect(b.page.getByRole('menuitem', { name: 'Şikayet et' })).toBeVisible();
  await expect(b.page.getByRole('menuitem', { name: 'Engelle' })).toBeVisible();
  await expect(b.page.getByRole('menuitem', { name: 'Sil' })).toHaveCount(0);
  await b.page.getByRole('menuitem', { name: 'Şikayet et' }).click();
  await expect(tid(b.page, 'info')).toContainText('Şikayet');

  await c.getByTestId('comment-menu').click();
  await b.page.getByRole('menuitem', { name: 'Engelle' }).click();
  await expect(tid(b.page, 'comment').filter({ hasText: 'rahatsiz-edici-yorum' })).toHaveCount(0);
  await b.page.reload();
  await expect(tid(b.page, 'comments-empty')).toBeVisible();

  // yazan kendi yorumunda Sil görür ve silebilir
  await page.reload();
  await tid(page, 'comment').first().getByTestId('comment-menu').click();
  await expect(page.getByRole('menuitem', { name: 'Sil' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Engelle' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Sil' }).click();
  await expect(tid(page, 'comments-empty')).toBeVisible();
  await b.ctx.close();
});

test('AC-MOB-9: hesap silme onay penceresiyle çalışır ve kullanıcıyı giriş ekranına döndürür', async ({ page }) => {
  const a = await register(page);
  await page.goto('/profile');
  await expect(tid(page, 'profile-handle')).toHaveText(`@${a.handle}`);
  await expect(tid(page, 'profile-email')).toHaveText(a.email);

  await tid(page, 'delete-account').click();
  await expect(page.getByTestId('delete-dialog')).toBeVisible();
  await page.getByTestId('delete-cancel').click(); // vazgeç: hesap duruyor
  await expect(page.getByTestId('delete-dialog')).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/profile$/);

  await tid(page, 'delete-account').click();
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
