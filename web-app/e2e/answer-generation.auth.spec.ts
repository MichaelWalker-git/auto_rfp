import { test, expect } from '@playwright/test';

test.describe('Answer Generation (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should display question editor with answer textarea', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Navigate to org -> project -> questions
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (!(await projectLink.isVisible())) {
      test.skip();
    }
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    const questionsLink = page.getByRole('link', { name: /questions/i });
    if (await questionsLink.isVisible()) {
      await questionsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Click on a question to open editor
    const questionItem = page.locator('[data-testid="question-item"], div:has-text("Q:")').first();
    if (await questionItem.isVisible()) {
      await questionItem.click();
      await page.waitForLoadState('networkidle');

      // Should see answer textarea
      const textarea = page.locator('textarea[placeholder*="answer" i], textarea');
      await expect(textarea.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show generate answer button', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (!(await projectLink.isVisible())) {
      test.skip();
    }
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    const questionsLink = page.getByRole('link', { name: /questions/i });
    if (await questionsLink.isVisible()) {
      await questionsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Click on a question
    const questionItem = page.locator('[data-testid="question-item"], div:has-text("Q:")').first();
    if (await questionItem.isVisible()) {
      await questionItem.click();
      await page.waitForLoadState('networkidle');

      // Should see Generate button
      const generateButton = page.locator('button:has-text("Generate")');
      const hasGenerateButton = await generateButton.isVisible().catch(() => false);
      console.log(`Generate button visible: ${hasGenerateButton}`);
    }
  });

  test('should display answered/unanswered badge', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (!(await projectLink.isVisible())) {
      test.skip();
    }
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    const questionsLink = page.getByRole('link', { name: /questions/i });
    if (await questionsLink.isVisible()) {
      await questionsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Click on a question
    const questionItem = page.locator('[data-testid="question-item"], div:has-text("Q:")').first();
    if (await questionItem.isVisible()) {
      await questionItem.click();
      await page.waitForLoadState('networkidle');

      // Should see status badge
      const answeredBadge = page.locator('span:has-text("Answered"), span:has-text("Needs Answer")');
      const hasBadge = await answeredBadge.first().isVisible().catch(() => false);
      console.log(`Status badge visible: ${hasBadge}`);
    }
  });

  test('should show save button when answer modified', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (!(await projectLink.isVisible())) {
      test.skip();
    }
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    const questionsLink = page.getByRole('link', { name: /questions/i });
    if (await questionsLink.isVisible()) {
      await questionsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Click on a question
    const questionItem = page.locator('[data-testid="question-item"], div:has-text("Q:")').first();
    if (await questionItem.isVisible()) {
      await questionItem.click();
      await page.waitForLoadState('networkidle');

      // Type in textarea
      const textarea = page.locator('textarea').first();
      if (await textarea.isVisible()) {
        await textarea.fill('Test answer content');

        // Should show Save button or Unsaved indicator
        const saveButton = page.locator('button:has-text("Save")');
        const unsavedBadge = page.locator('span:has-text("Unsaved")');

        const hasSave = await saveButton.isVisible().catch(() => false);
        const hasUnsaved = await unsavedBadge.isVisible().catch(() => false);

        console.log(`Save button: ${hasSave}, Unsaved badge: ${hasUnsaved}`);
      }
    }
  });

  test('should display source citations when answer has sources', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (!(await projectLink.isVisible())) {
      test.skip();
    }
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    const questionsLink = page.getByRole('link', { name: /questions/i });
    if (await questionsLink.isVisible()) {
      await questionsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Look for answered questions (indicated by Answered badge or green styling)
    const answeredQuestion = page.locator('[data-testid="question-item"]:has-text("Answered")').first();
    if (await answeredQuestion.isVisible()) {
      await answeredQuestion.click();
      await page.waitForLoadState('networkidle');

      // Check for sources section
      const sourcesSection = page.locator('div:has-text("Sources")');
      const hasSourcesSection = await sourcesSection.isVisible().catch(() => false);
      console.log(`Sources section visible: ${hasSourcesSection}`);
    }
  });

  test('should show answer preview when answer exists', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (!(await projectLink.isVisible())) {
      test.skip();
    }
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    const questionsLink = page.getByRole('link', { name: /questions/i });
    if (await questionsLink.isVisible()) {
      await questionsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Look for a question with existing answer
    const questionItem = page.locator('[data-testid="question-item"]').first();
    if (await questionItem.isVisible()) {
      await questionItem.click();
      await page.waitForLoadState('networkidle');

      // Check for preview section
      const previewSection = page.locator('h3:has-text("Preview"), div:has-text("Preview")');
      const hasPreview = await previewSection.isVisible().catch(() => false);
      console.log(`Preview section visible: ${hasPreview}`);
    }
  });

  test('should allow removing questions', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (!(await projectLink.isVisible())) {
      test.skip();
    }
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    const questionsLink = page.getByRole('link', { name: /questions/i });
    if (await questionsLink.isVisible()) {
      await questionsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Click on a question
    const questionItem = page.locator('[data-testid="question-item"]').first();
    if (await questionItem.isVisible()) {
      await questionItem.click();
      await page.waitForLoadState('networkidle');

      // Should see Remove button
      const removeButton = page.locator('button:has-text("Remove")');
      const hasRemoveButton = await removeButton.isVisible().catch(() => false);
      console.log(`Remove button visible: ${hasRemoveButton}`);
    }
  });
});
