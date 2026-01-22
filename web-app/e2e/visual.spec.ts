import { test, expect } from '@playwright/test';

test.describe('Visual Regression Tests', () => {
  test('home page screenshot', async ({ page }) => {
    await page.goto('/');

    // Wait for any animations to complete
    await page.waitForLoadState('networkidle');

    // Take a screenshot for visual comparison
    await expect(page).toHaveScreenshot('home-page.png', {
      fullPage: true,
      // Allow some pixel difference for anti-aliasing
      maxDiffPixelRatio: 0.01,
    });
  });

  test('help page screenshot', async ({ page }) => {
    await page.goto('/help');

    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('help-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test('dark mode screenshot', async ({ page }) => {
    await page.goto('/');

    // Trigger dark mode (adjust based on your theme implementation)
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });

    await page.waitForTimeout(500); // Wait for theme transition

    await expect(page).toHaveScreenshot('home-page-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('mobile viewport screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    await page.waitForLoadState('networkidle');

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
      'button-variants.png'
    );
  });
});
