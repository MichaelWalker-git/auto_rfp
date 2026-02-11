import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should display the landing page with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/AutoRFP/i);
  });

  test('should have visible content and no error state', async ({ page }) => {
    await page.goto('/');

    // Page should have visible body content
    await expect(page.locator('body')).toBeVisible();

    // Title should not indicate an error
    const title = await page.title();
    expect(title.toLowerCase()).not.toContain('error');
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should be responsive on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });
});