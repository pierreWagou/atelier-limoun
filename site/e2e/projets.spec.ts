import { expect, test } from '@playwright/test';

test('projects index lists the seeded project', async ({ page }) => {
  await page.goto('/projets');
  await expect(page.getByRole('heading', { level: 1, name: 'Projets' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Exemple de projet/ })).toBeVisible();
});

test('project detail page renders', async ({ page }) => {
  await page.goto('/projets/exemple-de-projet');
  await expect(page.getByRole('heading', { level: 1, name: 'Exemple de projet' })).toBeVisible();
});

test('navigation between index and detail works', async ({ page }) => {
  await page.goto('/projets');
  await page.getByRole('link', { name: /Exemple de projet/ }).click();
  await expect(page).toHaveURL(/\/projets\/exemple-de-projet$/);
});
