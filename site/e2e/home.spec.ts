import { expect, test } from '@playwright/test';

test('home renders hero and recent projects', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projets récents' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Exemple de projet/ })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('global contact info is shown in the footer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'contact@atelier-limoun.fr' })).toBeVisible();
});
