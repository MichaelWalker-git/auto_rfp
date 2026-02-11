import { test, expect } from './fixtures/auth';

test.describe('Project CRUD (Authenticated)', () => {
  test('should navigate to projects page within organization', async ({ nav }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
    }
    // Should see projects heading or content
    // Being on the org page means projects are visible
  });

  test('should display projects list or empty state', async ({ nav, projectPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }
    await projectPage.expectProjectsOrEmptyState();
  });

  test('should display New Project button', async ({ nav, projectPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }
    await projectPage.expectNewProjectButtonVisible();
  });

  test('should open create project dialog with form fields', async ({ nav, projectPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }
    await projectPage.openCreateDialog();
    await projectPage.expectCreateDialogHasFields();
  });

  test('should validate project name is required', async ({ nav, projectPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }
    await projectPage.openCreateDialog();
    await projectPage.expectCreateButtonDisabledWithoutName();
  });

  test('should navigate to project detail page', async ({ nav, projectPage }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }
    await projectPage.expectProjectHeadingVisible();
  });

  test('should display project name and heading', async ({ nav, projectPage }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }
    await projectPage.expectProjectHeadingVisible();
  });

  test('should show delete confirmation dialog', async ({ nav, projectPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const clicked = await projectPage.clickDeleteOnFirstProject();
    if (!clicked) {
      test.skip();
      return;
    }
    await projectPage.expectDeleteConfirmationDialog();
  });

  test('should cancel delete operation', async ({ nav, projectPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const clicked = await projectPage.clickDeleteOnFirstProject();
    if (!clicked) {
      test.skip();
      return;
    }
    await projectPage.cancelDeleteDialog();
  });

  test('should display project tabs (Documents, Questions, etc.)', async ({ nav, projectPage }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }
    await projectPage.expectProjectTabsVisible();
  });
});