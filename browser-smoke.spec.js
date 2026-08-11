import { test, expect } from '@playwright/test';

test('desktop visualization loads and controls collapse', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#startup-error')).toBeHidden();
  await expect(page.locator('#controls-collapse')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#simulation-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#simulation-panel')).toBeVisible();
  await expect(page.locator('#static-panel')).toBeHidden();
  await page.locator('#controls-collapse').click();
  await expect(page.locator('#controls-panel-content')).toBeHidden();
  await page.locator('#controls-collapse').click();
  await expect(page.locator('#controls-panel-content')).toBeVisible();
  await expect(page.locator('#static-local-time')).toBeEnabled({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('mobile controls start collapsed and can expand', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#controls-collapse')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#touch-help')).toBeVisible();
  await page.locator('#controls-collapse').click();
  await expect(page.locator('#controls-panel-content')).toBeVisible();
  await expect(page.locator('#touch-help')).toBeHidden();
  await context.close();
});
