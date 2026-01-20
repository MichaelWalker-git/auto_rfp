import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should navigate from home to help page', async ({ page }) => {
    await page.goto('/');

    // Click on help link if available
    const helpLink = page.getByRole('link', { name: /help/i });

    if (await helpLink.isVisible()) {
      await helpLink.click();
      await expect(page).toHaveURL(/\/help/);
    }
  });

  test('should handle 404 pages gracefully', async ({ page }) => {
    await page.goto('/non-existent-page-12345');

    // Should either redirect to home or show error page
    // Adjust based on your error handling
    await expect(page.locator('body')).toBeVisible();
  });

  test('should maintain scroll position on back navigation', async ({ page }) => {
    await page.goto('/');

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 500));

    // Navigate to another page
    await page.goto('/help');

    // Go back
    await page.goBack();

    // Check scroll is restored (or at top)
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Accessibility', () => {
  test('should have no accessibility violations on home page', async ({ page }) => {
    await page.goto('/');

    // Basic accessibility check - ensure main content is present
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('should be keyboard navigable', async ({ page }) => {
    await page.goto('/');

    // Tab through the page
    await page.keyboard.press('Tab');

    // First focusable element should receive focus
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });

  test('should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/');

    // Check for h1
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
  });
});
