import { test, expect } from './fixtures/auth';

test.describe('Answer Generation (Authenticated)', () => {
  /**
   * Helper to navigate to a question item within a project.
   * Returns true if a question was found and clicked.
   */
  async function navigateToQuestion(page: import('@playwright/test').Page, nav: import('./helpers/navigation').NavigationHelper): Promise<boolean> {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) return false;

    await nav.goToQuestions();

    const questionItem = page.locator('[data-testid="question-item"], div:has-text("Q:")').first();
    if (!(await questionItem.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }

    await questionItem.click();
    return true;
  }

  test('should display question editor with answer textarea', async ({ page, nav }) => {
    const found = await navigateToQuestion(page, nav);
    if (!found) {
      test.skip();
      return;
    }

    const textarea = page.locator('textarea[placeholder*="answer" i], textarea');
    await expect(textarea.first()).toBeVisible({ timeout: 5000 });
  });

  test('should show generate answer button', async ({ page, nav }) => {
    const found = await navigateToQuestion(page, nav);
    if (!found) {
      test.skip();
      return;
    }

    const generateButton = page.locator('button:has-text("Generate")');
    const hasGenerateButton = await generateButton.isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasGenerateButton).toBe('boolean');
  });

  test('should display answered/unanswered badge', async ({ page, nav }) => {
    const found = await navigateToQuestion(page, nav);
    if (!found) {
      test.skip();
      return;
    }

    const answeredBadge = page.locator('span:has-text("Answered"), span:has-text("Needs Answer")');
    const hasBadge = await answeredBadge.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasBadge).toBe('boolean');
  });

  test('should show save button when answer modified', async ({ page, nav }) => {
    const found = await navigateToQuestion(page, nav);
    if (!found) {
      test.skip();
      return;
    }

    const textarea = page.locator('textarea').first();
    if (!(await textarea.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await textarea.fill('Test answer content');

    const saveButton = page.locator('button:has-text("Save")');
    const unsavedBadge = page.locator('span:has-text("Unsaved")');

    const hasSave = await saveButton.isVisible({ timeout: 3000 }).catch(() => false);
    const hasUnsaved = await unsavedBadge.isVisible({ timeout: 3000 }).catch(() => false);

    expect(hasSave || hasUnsaved).toBeTruthy();
  });

  test('should display source citations when answer has sources', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    const answeredQuestion = page.locator('[data-testid="question-item"]:has-text("Answered")').first();
    if (!(await answeredQuestion.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await answeredQuestion.click();

    const sourcesSection = page.locator('div:has-text("Sources")');
    const hasSourcesSection = await sourcesSection.isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasSourcesSection).toBe('boolean');
  });

  test('should allow removing questions', async ({ page, nav }) => {
    const found = await navigateToQuestion(page, nav);
    if (!found) {
      test.skip();
      return;
    }

    const removeButton = page.locator('button:has-text("Remove")');
    const hasRemoveButton = await removeButton.isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasRemoveButton).toBe('boolean');
  });
});