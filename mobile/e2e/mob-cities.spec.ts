import { expect, test } from '@playwright/test';
import { register, tid, uniq } from './helpers';

test('AC-MOB-19: Yeni liste şehir alanı Türkçe ve İngilizce adlarla şehir ve ülke önerir; elle yazmak da serbest', async ({ page }) => {
  await register(page);
  await page.goto('/lists');
  if (!(await tid(page, 'list-create-form').isVisible())) await tid(page, 'list-new').click();
  const city = tid(page, 'list-city');
  const names = page.getByTestId('city-suggest-name');

  const firstFor = async (text: string, expected: string, detail?: RegExp) => {
    await city.fill('');
    await city.pressSequentially(text, { delay: 20 });
    await expect(names.first()).toHaveText(expected);
    if (detail) await expect(page.getByTestId('city-suggest-detail').first()).toHaveText(detail);
  };
  await firstFor('Ist', 'İstanbul', /Türkiye/);
  await firstFor('ist', 'İstanbul');
  await firstFor('eng', 'İngiltere', /England/);
  await firstFor('ing', 'İngiltere');
  await firstFor('rome', 'Roma', /İtalya · Rome/);
  await firstFor('cologne', 'Köln');
  await firstFor('kas', 'Kaş');
  await firstFor('spain', 'İspanya', /Ülke · Spain/);

  // öneri seçilince alan dolar ve liste o adla oluşur
  await city.fill('');
  await city.pressSequentially('lond', { delay: 20 });
  await page.getByTestId('city-suggest-item').filter({ hasText: 'Londra' }).first().click();
  await expect(city).toHaveValue('Londra');
  await expect(page.getByTestId('city-suggest')).toHaveCount(0);
  const title = `Londra ${uniq('l')}`;
  await tid(page, 'list-title').fill(title);
  await tid(page, 'list-create').click();
  await expect(tid(page, 'list-card').filter({ hasText: title })).toBeVisible();

  // listede olmayan bir yer elle yazılabilir
  if (!(await tid(page, 'list-create-form').isVisible())) await tid(page, 'list-new').click();
  await city.fill('Bizim Köy');
  const t2 = `Köy ${uniq('k')}`;
  await tid(page, 'list-title').fill(t2);
  await tid(page, 'list-create').click();
  await expect(tid(page, 'list-card').filter({ hasText: t2 })).toBeVisible();
});
