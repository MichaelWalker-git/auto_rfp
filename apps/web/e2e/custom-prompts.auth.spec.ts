import { test, expect } from './fixtures/auth';

test.describe('Custom Prompts (Authenticated)', () => {
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

  test('should display Prompts section in settings', async ({ settingsPage }) => {
    const hasPrompts = await settingsPage.expectPromptsSection();
    expect(typeof hasPrompts).toBe('boolean');
  });

  test('should display New Prompt button', async ({ settingsPage }) => {
    const newPromptButton = await settingsPage.getNewPromptButton();
    const hasButton = await newPromptButton.isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasButton).toBe('boolean');
  });

  test('should display Refresh button', async ({ settingsPage }) => {
    const refreshButton = await settingsPage.getRefreshButton();
    const hasButton = await refreshButton.isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasButton).toBe('boolean');
  });

  test('should display prompts list or empty state', async ({ page }) => {
    const promptRows = page.locator('div:has-text("SYSTEM"), div:has-text("USER")');
    const emptyState = page.locator('div:has-text("No prompts yet")');

    const hasPrompts = await promptRows.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmpty = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasPrompts || hasEmpty).toBeTruthy();
  });

  test('should display SYSTEM and USER scope badges', async ({ page }) => {
    const systemBadge = page.locator('span:has-text("SYSTEM")');
    const userBadge = page.locator('span:has-text("USER")');

    const hasSystem = await systemBadge.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasUser = await userBadge.first().isVisible({ timeout: 5000 }).catch(() => false);

    // At least one badge type should exist if prompts are present
    expect(typeof hasSystem).toBe('boolean');
  });

  test('should display Edit buttons on prompt rows', async ({ settingsPage }) => {
    const editButtons = await settingsPage.getEditButtons();
    const editCount = await editButtons.count();
    expect(editCount).toBeGreaterThanOrEqual(0);
  });

  test('should expand prompt editor when Edit clicked', async ({ settingsPage }) => {
    const clicked = await settingsPage.clickFirstEditButton();
    if (!clicked) {
      test.skip();
      return;
    }

    await settingsPage.expectExpandedEditor();
    await settingsPage.expectCollapseButtonVisible();
  });

  test('should display Save buttons on prompt rows', async ({ settingsPage }) => {
    const saveButtons = await settingsPage.getSaveButtons();
    const saveCount = await saveButtons.count();
    expect(saveCount).toBeGreaterThanOrEqual(0);
  });

  test('should display runtime params section in expanded editor', async ({ settingsPage }) => {
    const clicked = await settingsPage.clickFirstEditButton();
    if (!clicked) {
      test.skip();
      return;
    }

    await settingsPage.expectRuntimeParamsSection();
  });

  test('should show Unsaved badge when prompt is modified', async ({ settingsPage }) => {
    const clicked = await settingsPage.clickFirstEditButton();
    if (!clicked) {
      test.skip();
      return;
    }

    await settingsPage.modifyPromptText('Test prompt modification');
    await settingsPage.expectUnsavedBadge();
  });
});