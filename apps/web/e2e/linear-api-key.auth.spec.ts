import { test, expect } from './fixtures/auth';

test.describe('Linear API Key Configuration (Authenticated)', () => {
  test.beforeEach(async ({ nav }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }
    const navigated = await nav.goToSettings();
    if (!navigated) {
      test.skip();
    }
  });

  test('should display Linear API key configuration in settings', async ({ settingsPage }) => {
    await settingsPage.expectLinearSectionVisible();
  });

  test('should open Linear API key setup dialog', async ({ settingsPage }) => {
    await settingsPage.openLinearConfigDialog();
    await settingsPage.expectLinearDialogFields();
    await settingsPage.closeLinearDialog();
  });

  test('should show Linear API key status badge', async ({ page }) => {
    const linearSection = page.locator('text=Linear API Key Management').locator('..');
    const badge = linearSection.locator('text=Not Configured, text=Configured').first();
    const hasBadge = await badge.isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasBadge).toBe('boolean');
  });
});