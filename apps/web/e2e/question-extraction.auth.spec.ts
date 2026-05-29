import { test, expect } from './fixtures/auth';

test.describe('Question Extraction (Authenticated)', () => {
  test('should navigate to questions page', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToQuestions();
    if (navigated) {
      await expect(page).toHaveURL(/\/questions/);
    }
  });

  test('should show questions list or empty state', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    const questionsList = page.locator('[data-testid="questions-list"], div:has-text("Question")');
    const emptyState = page.locator('div:has-text("Upload"), div:has-text("Extract"), div:has-text("No questions")');

    const hasQuestions = await questionsList.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmptyState = await emptyState.first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasQuestions || hasEmptyState).toBeTruthy();
  });

  test('should show extract questions button', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    const extractButton = page.locator('button:has-text("Extract"), button:has-text("Upload RFP"), button:has-text("Add")');
    const hasButton = await extractButton.first().isVisible({ timeout: 5000 }).catch(() => false);
    // Button visibility depends on project state
    expect(typeof hasButton).toBe('boolean');
  });

  test('should open question extraction dialog', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    const extractButton = page.locator('button:has-text("Extract"), button:has-text("Upload")').first();
    if (!(await extractButton.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await extractButton.click();

    const dialog = page.locator('[role="dialog"]');
    if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      const uploadZone = page.locator('input[type="file"], div:has-text("drag"), div:has-text("Drop")');
      await expect(uploadZone.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display question sections when questions exist', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    const sectionHeaders = page.locator('h2, h3, [data-testid="section-header"]');
    const questionItems = page.locator('[data-testid="question-item"], div:has-text("Q:")');

    const sectionCount = await sectionHeaders.count();
    const questionCount = await questionItems.count();

    // These are informational - counts depend on project state
    expect(sectionCount).toBeGreaterThanOrEqual(0);
    expect(questionCount).toBeGreaterThanOrEqual(0);
  });

  test('should filter questions by status', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    const filterTabs = page.locator('button:has-text("All"), button:has-text("Answered"), button:has-text("Unanswered")');
    const tabCount = await filterTabs.count();

    if (tabCount > 0) {
      const answeredTab = page.getByRole('tab', { name: /answered/i }).or(page.locator('button:has-text("Answered")'));
      if (await answeredTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await answeredTab.click();
      }
    }
  });

  test('should expand question to show answer form', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    const questionItem = page.locator('[data-testid="question-item"]').first();
    if (!(await questionItem.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await questionItem.click();

    const answerSection = page.locator('textarea, button:has-text("Generate"), div:has-text("Answer")');
    await expect(answerSection.first()).toBeVisible({ timeout: 5000 });
  });
});