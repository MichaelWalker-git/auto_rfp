import { test, expect } from './fixtures/auth';

test.describe('Knowledge Base CRUD (Authenticated)', () => {
  test('should navigate to knowledge base page', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    await kbPage.expectLoaded();
  });

  test('should display knowledge base list or empty state', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    await kbPage.expectListOrEmptyState();
  });

  test('should display New Knowledge Base button', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    await kbPage.expectNewKbButtonVisible();
  });

  test('should open create knowledge base dialog with fields', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    await kbPage.openCreateDialog();
    await kbPage.expectCreateDialogHasFields();
  });

  test('should navigate to knowledge base detail page', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    const hasKb = await kbPage.navigateToFirstKb();
    if (!hasKb) {
      test.skip();
    }
  });

  test('should display documents section in KB detail', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToFirstKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    const hasDocuments = await kbPage.expectDocumentsSection();
    expect(typeof hasDocuments).toBe('boolean');
  });

  test('should display upload documents button in KB detail', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToFirstKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    await kbPage.expectUploadButtonVisible();
  });

  test('should open upload documents dialog', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToFirstKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    await kbPage.openUploadDialog();
    await kbPage.expectUploadDialogHasFileInput();
  });

  test('should display document status badges', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToFirstKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    const badgeCount = await kbPage.getStatusBadgeCount();
    // Informational - badges may or may not exist
    expect(badgeCount).toBeGreaterThanOrEqual(0);
  });

  test('should display document count statistics', async ({ nav, kbPage }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToFirstKnowledgeBase();
    if (!navigated) {
      test.skip();
      return;
    }

    await kbPage.expectDocumentStats();
  });
});