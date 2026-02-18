import { test, expect } from '@playwright/test';

test.describe('Visual Regression Tests', () => {
  test('home page screenshot', async ({ page }) => {
    await page.goto('/');
    // Wait for content to be fully rendered
    await page.locator('body').waitFor({ state: 'visible' });

    await expect(page).toHaveScreenshot('home-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test('help page screenshot', async ({ page }) => {
    await page.goto('/help');
    await page.locator('body').waitFor({ state: 'visible' });

    await expect(page).toHaveScreenshot('help-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test('dark mode screenshot', async ({ page }) => {
    // Set dark theme via localStorage before navigating (next-themes reads this)
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'dark');
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Ensure dark class is applied (next-themes uses attribute="class")
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });

    // Wait for styles to settle
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('home-page-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });

  test('mobile viewport screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.locator('body').waitFor({ state: 'visible' });

    await expect(page).toHaveScreenshot('home-page-mobile.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Component Visual Tests', () => {
  test.skip('button variants', async ({ page }) => {
    // This would navigate to a Storybook or component playground page
    await page.goto('/components/button');

    await expect(page.locator('[data-testid="button-variants"]')).toHaveScreenshot(
      'button-variants.png',
    );
  });
});