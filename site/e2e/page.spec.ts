import { expect, test } from '@playwright/test';

test('CMS-driven page renders its content', async ({ page }) => {
  await page.goto('/a-propos');
  await expect(page.getByRole('heading', { level: 1, name: 'À propos' })).toBeVisible();
  await expect(page.getByText(/démonstration/)).toBeVisible();
});
