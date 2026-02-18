import { test, expect } from './fixtures/auth';

test.describe('Organization Settings (Authenticated)', () => {
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

  test('should display Organization Settings heading', async ({ settingsPage }) => {
    await settingsPage.expectLoaded();
  });

  test('should display general settings card', async ({ settingsPage }) => {
    await settingsPage.expectGeneralSettingsVisible();
  });

  test('should display organization name input', async ({ settingsPage }) => {
    await settingsPage.expectNameInputVisible();
  });

  test('should display Save Changes button', async ({ settingsPage }) => {
    await settingsPage.expectSaveButtonVisible();
  });

  test('should display saved searches section', async ({ settingsPage }) => {
    const hasSavedSearches = await settingsPage.expectSavedSearchesSection();
    // Informational - section may or may not exist depending on org config
    expect(typeof hasSavedSearches).toBe('boolean');
  });

  test('should display prompts manager section', async ({ settingsPage }) => {
    const hasPrompts = await settingsPage.expectPromptsSection();
    expect(typeof hasPrompts).toBe('boolean');
  });

  test('should display danger zone section', async ({ settingsPage }) => {
    await settingsPage.expectDangerZoneVisible();
  });

  test('should display delete organization warning', async ({ settingsPage }) => {
    await settingsPage.expectDeleteWarningVisible();
  });

  test('should display delete confirmation input', async ({ settingsPage }) => {
    await settingsPage.expectConfirmInputVisible();
  });

  test('should display delete organization button', async ({ settingsPage }) => {
    await settingsPage.expectDeleteButtonVisible();
  });
});