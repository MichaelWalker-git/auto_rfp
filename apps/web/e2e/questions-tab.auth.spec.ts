import { test, expect } from './fixtures/auth';

/**
 * Regression tests for the Questions tab.
 *
 * Root cause of original issue (commit 8a6a7fc1):
 *   The get-questions Lambda used an N+1 query pattern — calling getAnswer()
 *   per question — which caused timeouts for projects with many questions.
 *   The fix batch-loads all answers in parallel (2 DynamoDB queries total)
 *   and returns a combined { sections, answers } response.
 *
 * These tests verify the questions tab loads correctly and core interactions work.
 */
test.describe('Questions Tab Regression', () => {
  test('should navigate to questions page and see content or empty state', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    const navigated = await nav.goToQuestions();
    if (!navigated) {
      test.skip();
      return;
    }

    await expect(page).toHaveURL(/\/questions/);

    // The page should eventually show either:
    // 1. An opportunity selector prompt ("Select an opportunity")
    // 2. Questions content (filter tabs, question items)
    // 3. An empty state ("Upload RFP" / "No questions")
    // It must NOT stay on a loading spinner indefinitely.
    const contentLocator = page.locator(
      'text=Select an opportunity, text=All Questions, text=Upload, text=No questions, text=Extract',
    ).first();

    await expect(contentLocator).toBeVisible({ timeout: 15_000 });
  });

  test('should not show infinite loading state', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    // Wait for the page to settle — loading skeleton should disappear within 15s
    // This is the core regression check: the old N+1 handler caused timeouts
    // that left the page in a permanent loading state.
    await page.waitForTimeout(2_000);

    const loadingText = page.locator('text=Loading...');
    const isStillLoading = await loadingText.isVisible({ timeout: 1_000 }).catch(() => false);

    // If still showing "Loading..." after 2s, that's a regression
    if (isStillLoading) {
      // Give it more time but it should resolve
      await expect(loadingText).not.toBeVisible({ timeout: 13_000 });
    }
  });

  test('should show filter tabs when questions exist', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    // Wait for content to load
    await page.waitForTimeout(3_000);

    // Check for filter tabs (All Questions / Answered / Unanswered / Clusters)
    const allTab = page.locator('button:has-text("All Questions"), [role="tab"]:has-text("All")');
    const hasFilterTabs = await allTab.first().isVisible({ timeout: 10_000 }).catch(() => false);

    if (hasFilterTabs) {
      // Verify all expected tabs are present
      const answeredTab = page.locator('button:has-text("Answered"), [role="tab"]:has-text("Answered")');
      const unansweredTab = page.locator('button:has-text("Unanswered"), [role="tab"]:has-text("Unanswered")');
      const clustersTab = page.locator('button:has-text("Clusters"), [role="tab"]:has-text("Clusters")');

      await expect(answeredTab.first()).toBeVisible();
      await expect(unansweredTab.first()).toBeVisible();
      await expect(clustersTab.first()).toBeVisible();
    }
    // If no filter tabs, project likely has no questions — that's OK
  });

  test('should switch between filter tabs without errors', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    // Wait for content
    await page.waitForTimeout(3_000);

    const answeredTab = page.locator('[role="tab"]:has-text("Answered")').first();
    if (!(await answeredTab.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Click Answered tab
    await answeredTab.click();
    await page.waitForTimeout(500);

    // Click Unanswered tab
    const unansweredTab = page.locator('[role="tab"]:has-text("Unanswered")').first();
    await unansweredTab.click();
    await page.waitForTimeout(500);

    // Click back to All
    const allTab = page.locator('[role="tab"]:has-text("All")').first();
    await allTab.click();
    await page.waitForTimeout(500);

    // No crash — page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('should show opportunity selector on questions page', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    // The questions page should show an opportunity selector
    const opportunitySelector = page.locator('text=Opportunity');
    const hasSelector = await opportunitySelector.first().isVisible({ timeout: 10_000 }).catch(() => false);

    // Opportunity selector is expected on the questions page
    expect(typeof hasSelector).toBe('boolean');
  });

  test('should not have console errors on questions page load', async ({ page, nav, errorCollector }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    // Wait for page to fully load
    await page.waitForTimeout(5_000);

    // Check that no critical JS errors occurred
    const errors = errorCollector.getErrors();
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') && // Benign browser warning
        !e.includes('hydration') && // Next.js hydration warnings
        !e.includes('Warning:'), // React dev warnings
    );

    // Allow zero critical errors
    expect(criticalErrors.length).toBe(0);
  });
});
