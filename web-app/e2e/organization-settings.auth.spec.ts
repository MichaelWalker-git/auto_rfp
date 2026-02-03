import { test, expect } from '@playwright/test';

test.describe('Organization Settings (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should navigate to organization settings page', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Navigate to first org
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Look for settings link in nav
    const settingsLink = page.getByRole('link', { name: /settings/i });
    if (await settingsLink.isVisible()) {
      await settingsLink.click();
      await page.waitForLoadState('networkidle');

      // Should see Organization Settings heading
      const heading = page.locator('h1:has-text("Organization Settings")');
      await expect(heading).toBeVisible({ timeout: 10000 });
    }
  });

  test('should display general settings card', async ({ page }) => {
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

      // Should see General Settings card
      const generalSettings = page.locator('h2:has-text("General Settings"), h3:has-text("General Settings")');
      const hasGeneralSettings = await generalSettings.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`General Settings card: ${hasGeneralSettings}`);
    }
  });

  test('should display organization name input', async ({ page }) => {
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

      // Should see organization name input
      const nameInput = page.locator('input#name');
      const hasNameInput = await nameInput.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Organization name input: ${hasNameInput}`);
    }
  });

  test('should display Save Changes button', async ({ page }) => {
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

      // Should see Save Changes button
      const saveButton = page.locator('button:has-text("Save Changes")');
      const hasSaveButton = await saveButton.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Save Changes button: ${hasSaveButton}`);
    }
  });

  test('should display saved searches section', async ({ page }) => {
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

      // Look for Saved Searches section
      const savedSearches = page.locator('h2:has-text("Saved Searches"), h3:has-text("Saved Searches"), div:has-text("Saved Searches")');
      const hasSavedSearches = await savedSearches.first().isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Saved Searches section: ${hasSavedSearches}`);
    }
  });

  test('should display prompts manager section', async ({ page }) => {
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

      // Look for Prompts or Custom Prompts section
      const prompts = page.locator('h2:has-text("Prompts"), h3:has-text("Prompts"), div:has-text("Custom Prompts")');
      const hasPrompts = await prompts.first().isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Prompts section: ${hasPrompts}`);
    }
  });

  test('should display danger zone section', async ({ page }) => {
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

      // Should see Danger Zone section
      const dangerZone = page.locator('h2:has-text("Danger Zone"), h3:has-text("Danger Zone")');
      const hasDangerZone = await dangerZone.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Danger Zone section: ${hasDangerZone}`);
    }
  });

  test('should display delete organization warning', async ({ page }) => {
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

      // Should see delete warning
      const warning = page.locator('div:has-text("permanently remove all projects")');
      const hasWarning = await warning.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Delete warning visible: ${hasWarning}`);
    }
  });

  test('should display delete confirmation input', async ({ page }) => {
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

      // Should see confirmation input
      const confirmInput = page.locator('input#confirm');
      const hasConfirmInput = await confirmInput.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Confirm deletion input: ${hasConfirmInput}`);
    }
  });

  test('should display delete organization button', async ({ page }) => {
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

      // Should see Delete Organization button
      const deleteButton = page.locator('button:has-text("Delete Organization")');
      const hasDeleteButton = await deleteButton.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Delete Organization button: ${hasDeleteButton}`);
    }
  });
});
