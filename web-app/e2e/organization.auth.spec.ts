import { test, expect } from './fixtures/auth';

test.describe('Organization Management (Authenticated)', () => {
  test('should display organization list with heading', async ({ orgsPage }) => {
    await orgsPage.goto();
    await orgsPage.expectLoaded();
  });

  test('should show create organization button', async ({ orgsPage }) => {
    await orgsPage.goto();
    await orgsPage.expectCreateButtonVisible();
  });

  test('should open create organization modal', async ({ orgsPage }) => {
    await orgsPage.goto();
    await orgsPage.openCreateDialog();
  });

  test('should navigate to organization details', async ({ orgsPage }) => {
    await orgsPage.goto();

    if (!(await orgsPage.hasOrganizations())) {
      test.skip();
    }

    const navigated = await orgsPage.navigateToFirstOrg();
    expect(navigated).toBeTruthy();
  });

  test('should create organization successfully', async ({ orgsPage, errorCollector }) => {
    await orgsPage.goto();

    const uniqueName = `E2E Test Org ${Date.now()}`;
    await orgsPage.createOrganization(uniqueName, 'Organization created by e2e test - safe to delete');

    // Wait for response
    await orgsPage.expectOrganizationCreated(uniqueName);

    // Verify no JS errors occurred
    errorCollector.expectNoCriticalErrors();
  });

  test('should validate required fields on create', async ({ orgsPage }) => {
    await orgsPage.goto();
    await orgsPage.openCreateDialog();
    await orgsPage.submitEmptyForm();
    await orgsPage.expectValidationError();
  });

  test('should handle duplicate organization name gracefully', async ({ page, orgsPage }) => {
    await orgsPage.goto();

    const firstOrgName = await orgsPage.getFirstOrgName();
    if (!firstOrgName) {
      test.skip();
      return;
    }

    await orgsPage.openCreateDialog();

    const nameInput = page.locator('input[id="name"], input[name="name"]').first();
    await nameInput.fill(firstOrgName);

    const submitButton = page.locator('button[type="submit"], button:has-text("Create")').first();
    await submitButton.click();

    // Page should not crash
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Project Management (Authenticated)', () => {
  test('should display projects within organization', async ({ nav, projectPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    await projectPage.expectProjectsOrEmptyState();
  });

  test('should show create project button', async ({ nav, projectPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    await projectPage.expectNewProjectButtonVisible();
  });
});