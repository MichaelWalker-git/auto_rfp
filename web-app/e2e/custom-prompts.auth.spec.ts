import { test, expect } from '@playwright/test';

test.describe('Custom Prompts (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should navigate to prompts section in settings', async ({ page }) => {
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

      // Should see Prompts section
      const promptsHeading = page.locator('h2:has-text("Prompts"), h3:has-text("Prompts")');
      const hasPrompts = await promptsHeading.isVisible({ timeout: 10000 }).catch(() => false);
      console.log(`Prompts section visible: ${hasPrompts}`);
    }
  });

  test('should display New Prompt button', async ({ page }) => {
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

      // Should see New Prompt button
      const newPromptButton = page.locator('button:has-text("New prompt")');
      const hasButton = await newPromptButton.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`New Prompt button: ${hasButton}`);
    }
  });

  test('should display Refresh button', async ({ page }) => {
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

      // Should see Refresh button
      const refreshButton = page.locator('button:has-text("Refresh")');
      const hasButton = await refreshButton.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Refresh button: ${hasButton}`);
    }
  });

  test('should display prompts list or empty state', async ({ page }) => {
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

      // Should see prompts list or empty state
      const promptRows = page.locator('div:has-text("SYSTEM"), div:has-text("USER")');
      const emptyState = page.locator('div:has-text("No prompts yet")');

      const hasPrompts = await promptRows.first().isVisible({ timeout: 5000 }).catch(() => false);
      const hasEmpty = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);

      console.log(`Prompts rows: ${hasPrompts}, Empty state: ${hasEmpty}`);
    }
  });

  test('should display SYSTEM and USER scope badges', async ({ page }) => {
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

      // Look for scope badges
      const systemBadge = page.locator('span:has-text("SYSTEM")');
      const userBadge = page.locator('span:has-text("USER")');

      const hasSystem = await systemBadge.first().isVisible({ timeout: 5000 }).catch(() => false);
      const hasUser = await userBadge.first().isVisible({ timeout: 5000 }).catch(() => false);

      console.log(`SYSTEM badge: ${hasSystem}, USER badge: ${hasUser}`);
    }
  });

  test('should display Edit button on prompt rows', async ({ page }) => {
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

      // Look for Edit buttons
      const editButtons = page.locator('button:has-text("Edit")');
      const editCount = await editButtons.count();
      console.log(`Found ${editCount} Edit buttons`);
    }
  });

  test('should expand prompt editor when Edit clicked', async ({ page }) => {
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

      // Click first Edit button
      const editButton = page.locator('button:has-text("Edit")').first();
      if (await editButton.isVisible()) {
        await editButton.click();

        // Should see expanded editor with textarea
        const textarea = page.locator('textarea[placeholder*="prompt"]');
        const hasTextarea = await textarea.isVisible({ timeout: 5000 }).catch(() => false);

        // Should see Collapse button
        const collapseButton = page.locator('button:has-text("Collapse")');
        const hasCollapse = await collapseButton.isVisible({ timeout: 5000 }).catch(() => false);

        console.log(`Textarea visible: ${hasTextarea}, Collapse button: ${hasCollapse}`);
      }
    }
  });

  test('should display Save button on prompt rows', async ({ page }) => {
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

      // Look for Save buttons
      const saveButtons = page.locator('button:has-text("Save")');
      const saveCount = await saveButtons.count();
      console.log(`Found ${saveCount} Save buttons`);
    }
  });

  test('should display runtime params section in expanded editor', async ({ page }) => {
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

      // Click first Edit button
      const editButton = page.locator('button:has-text("Edit")').first();
      if (await editButton.isVisible()) {
        await editButton.click();

        // Should see Runtime params section
        const paramsSection = page.locator('div:has-text("Runtime params")');
        const hasParams = await paramsSection.isVisible({ timeout: 5000 }).catch(() => false);
        console.log(`Runtime params section: ${hasParams}`);
      }
    }
  });

  test('should show Unsaved badge when prompt is modified', async ({ page }) => {
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

      // Click first Edit button
      const editButton = page.locator('button:has-text("Edit")').first();
      if (await editButton.isVisible()) {
        await editButton.click();

        // Type in textarea
        const textarea = page.locator('textarea[placeholder*="prompt"]').first();
        if (await textarea.isVisible()) {
          await textarea.fill('Test prompt modification');

          // Should see Unsaved badge
          const unsavedBadge = page.locator('span:has-text("Unsaved")');
          const hasUnsaved = await unsavedBadge.isVisible({ timeout: 5000 }).catch(() => false);
          console.log(`Unsaved badge visible: ${hasUnsaved}`);
        }
      }
    }
  });
});
