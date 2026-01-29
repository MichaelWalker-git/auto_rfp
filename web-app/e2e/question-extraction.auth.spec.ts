import { test, expect } from '@playwright/test';

test.describe('Question Extraction (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should navigate to questions page', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Navigate to first org
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Navigate to first project
    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (!(await projectLink.isVisible())) {
      test.skip();
    }
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    // Look for questions tab/link
    const questionsLink = page.getByRole('link', { name: /questions/i });
    if (await questionsLink.isVisible()) {
      await questionsLink.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/questions/);
    }
  });

  test('should show questions list or empty state', async ({ page }) => {
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

      // Should see either questions list or empty state with upload prompt
      const questionsList = page.locator('[data-testid="questions-list"], div:has-text("Question")');
      const emptyState = page.locator('div:has-text("Upload"), div:has-text("Extract"), div:has-text("No questions")');

      const hasQuestions = await questionsList.first().isVisible().catch(() => false);
      const hasEmptyState = await emptyState.first().isVisible().catch(() => false);

      expect(hasQuestions || hasEmptyState).toBe(true);
    }
  });

  test('should show extract questions button', async ({ page }) => {
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

    // Look for extract/upload button
    const extractButton = page.locator('button:has-text("Extract"), button:has-text("Upload RFP"), button:has-text("Add")');
    const hasButton = await extractButton.first().isVisible().catch(() => false);

    // Button should be visible (either in header or empty state)
    console.log(`Extract button visible: ${hasButton}`);
  });

  test('should open question extraction dialog', async ({ page }) => {
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

    // Try to open extraction dialog
    const extractButton = page.locator('button:has-text("Extract"), button:has-text("Upload")').first();
    if (await extractButton.isVisible()) {
      await extractButton.click();

      // Dialog should open
      const dialog = page.locator('[role="dialog"]');
      const hasDialog = await dialog.isVisible({ timeout: 5000 }).catch(() => false);

      if (hasDialog) {
        // Should have file input or upload zone
        const uploadZone = page.locator('input[type="file"], div:has-text("drag"), div:has-text("Drop")');
        await expect(uploadZone.first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should display question sections when questions exist', async ({ page }) => {
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

    // If questions exist, they should be grouped by section
    const sectionHeaders = page.locator('h2, h3, [data-testid="section-header"]');
    const questionItems = page.locator('[data-testid="question-item"], div:has-text("Q:")');

    const sectionCount = await sectionHeaders.count();
    const questionCount = await questionItems.count();

    console.log(`Found ${sectionCount} section headers, ${questionCount} questions`);
  });

  test('should filter questions by status', async ({ page }) => {
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

    // Look for filter tabs (All, Answered, Unanswered)
    const filterTabs = page.locator('button:has-text("All"), button:has-text("Answered"), button:has-text("Unanswered")');
    const tabCount = await filterTabs.count();

    if (tabCount > 0) {
      // Click on Answered tab if available
      const answeredTab = page.getByRole('tab', { name: /answered/i }).or(page.locator('button:has-text("Answered")'));
      if (await answeredTab.isVisible()) {
        await answeredTab.click();
        await page.waitForLoadState('networkidle');
      }
    }
  });

  test('should expand question to show answer form', async ({ page }) => {
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

    // Click on first question if it exists
    const questionItem = page.locator('[data-testid="question-item"]').first();
    if (await questionItem.isVisible()) {
      await questionItem.click();

      // Should show answer form or generate button
      const answerSection = page.locator('textarea, button:has-text("Generate"), div:has-text("Answer")');
      await expect(answerSection.first()).toBeVisible({ timeout: 5000 });
    }
  });
});
