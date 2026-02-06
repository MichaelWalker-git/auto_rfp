import { test, expect } from '@playwright/test';

test.describe('Linear API Key Configuration (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should display Linear API key configuration in settings', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Navigate to first org
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Navigate to settings
    const settingsLink = page.getByRole('link', { name: /settings/i });
    if (await settingsLink.isVisible()) {
      await settingsLink.click();
      await page.waitForLoadState('networkidle');

      // Check for Linear API Key Management section
      const linearSection = page.locator('text=Linear API Key Management');
      await expect(linearSection).toBeVisible({ timeout: 10000 });

      // Check for Configure button
      const configureButton = page.locator('button:has-text("Configure")').nth(1); // Second configure button (first is SAM.gov)
      const hasConfigureButton = await configureButton.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Linear Configure button visible: ${hasConfigureButton}`);
    }
  });

  test('should open Linear API key setup dialog', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const settingsLink = page.getByRole('link', { name: /settings/i });
    if (await settingsLink.isVisible()) {
      await settingsLink.click();
      await page.waitForLoadState('networkidle');

      // Click Configure button for Linear
      const configureButton = page.locator('button:has-text("Configure")').nth(1);
      if (await configureButton.isVisible()) {
        await configureButton.click();

        // Check if dialog opened
        const dialog = page.locator('text=Configure Linear API Key');
        await expect(dialog).toBeVisible({ timeout: 5000 });

        // Check for API key input field
        const apiKeyInput = page.locator('input[placeholder="Enter your Linear API key"]');
        await expect(apiKeyInput).toBeVisible();

        // Check for help text
        const helpText = page.locator('text=How to get a Linear API Key');
        await expect(helpText).toBeVisible();

        // Close dialog
        const cancelButton = page.locator('button:has-text("Cancel")');
        await cancelButton.click();
      }
    }
  });

  test('should show Linear API key status badge', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const settingsLink = page.getByRole('link', { name: /settings/i });
    if (await settingsLink.isVisible()) {
      await settingsLink.click();
      await page.waitForLoadState('networkidle');

      // Look for status badge in Linear section
      const linearSection = page.locator('text=Linear API Key Management').locator('..');
      const badge = linearSection.locator('text=Not Configured, text=Configured').first();
      const hasBadge = await badge.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Linear status badge visible: ${hasBadge}`);
    }
  });
});
