import { test, expect } from './fixtures/auth';
import { JSErrorCollector } from './helpers/errors';

/**
 * E2E Regression Tests for Sentry Errors
 *
 * These tests catch and prevent the recurrence of errors reported in Sentry.
 * Each test corresponds to one or more Sentry issues.
 *
 * Sentry Issues Covered:
 * - AUTO-RFP-5V/5W: TypeError reading 'name' on /organizations
 * - AUTO-RFP-6J/6K: ReferenceError useOrganization not defined
 * - AUTO-RFP-6H: ReferenceError useMemo not defined
 * - AUTO-RFP-6C: ReferenceError formatDate not defined
 * - AUTO-RFP-6D: ReferenceError KnowledgeBaseCard not defined
 * - AUTO-RFP-6B: ReferenceError GenerateRFPDocumentModel not defined
 * - AUTO-RFP-6A/69: ReferenceError children not defined
 * - AUTO-RFP-68: ReferenceError GlobalHeader not defined
 * - AUTO-RFP-61: ReferenceError useEffect not defined
 * - AUTO-RFP-65: Rage Click on knowledge base page
 */

test.describe('Sentry Regression: Organization Pages', () => {
  /** AUTO-RFP-5V/5W: TypeError Cannot read properties of undefined (reading 'name') */
  test('should load organizations page without TypeError [AUTO-RFP-5V/5W]', async ({ page, errorCollector }) => {
    await page.goto('/organizations');
    await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible', timeout: 15000 });

    const typeErrors = errorCollector.getErrorsMatching('TypeError', "reading 'name'");
    expect(typeErrors).toHaveLength(0);

    // Verify page renders correctly
    const hasContent = await page.locator('h1, [data-testid="organizations-list"], [data-testid="empty-state"]').first().isVisible();
    expect(hasContent).toBeTruthy();
  });

  /** AUTO-RFP-6J/6K: ReferenceError useOrganization is not defined */
  test('should load projects page without useOrganization ReferenceError [AUTO-RFP-6J/6K]', async ({ page, nav, errorCollector }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const referenceErrors = errorCollector.getErrorsMatching('ReferenceError', 'useOrganization');
    expect(referenceErrors).toHaveLength(0);
  });

  /** Test organization creation flow */
  test('should create organization without errors', async ({ orgsPage, errorCollector }) => {
    await orgsPage.goto();

    const uniqueName = `Test Org ${Date.now()}`;
    await orgsPage.createOrganization(uniqueName, 'Test organization created by e2e test');

    await orgsPage.expectOrganizationCreated(uniqueName);
    errorCollector.expectNoCriticalErrors();
  });
});

test.describe('Sentry Regression: Knowledge Base Pages', () => {
  /** AUTO-RFP-6D/68: ReferenceError KnowledgeBaseCard/GlobalHeader not defined */
  test('should load knowledge base page without ReferenceErrors [AUTO-RFP-6D/68]', async ({ page, nav, errorCollector }) => {
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

    const referenceErrors = errorCollector.getErrorsMatching('ReferenceError', 'KnowledgeBaseCard', 'GlobalHeader');
    expect(referenceErrors).toHaveLength(0);
  });

  /** AUTO-RFP-65: Rage Click on knowledge base page */
  test('should respond to clicks without delay [AUTO-RFP-65]', async ({ page, nav }) => {
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

    const actionButton = page.locator('button').first();
    if (await actionButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      const startTime = Date.now();
      await actionButton.click();
      const clickDuration = Date.now() - startTime;

      // Click should respond within 500ms to prevent rage clicking
      expect(clickDuration).toBeLessThan(500);
    }
  });
});

test.describe('Sentry Regression: Documents Page', () => {
  /** AUTO-RFP-6H/61: ReferenceError useMemo/useEffect not defined */
  test('should load documents page without hook ReferenceErrors [AUTO-RFP-6H/61]', async ({ page, nav, errorCollector }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    const documentsLink = page.locator('a[href*="/documents"], button:has-text("Documents")').first();
    if (await documentsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await documentsLink.click();
    }

    const hookErrors = errorCollector.getErrorsMatching('ReferenceError', 'useMemo', 'useEffect');
    expect(hookErrors).toHaveLength(0);
  });
});

test.describe('Sentry Regression: Proposals Page', () => {
  /** AUTO-RFP-6A/69/6B/6G: ReferenceError children/GenerateRFPDocumentModel not defined */
  test('should load proposals page without ReferenceErrors [AUTO-RFP-6A/69/6B/6G]', async ({ page, nav, errorCollector }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    const proposalsLink = page.locator('a[href*="/proposals"], button:has-text("Proposals")').first();
    if (await proposalsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await proposalsLink.click();
    }

    const proposalErrors = errorCollector.getErrorsMatching('ReferenceError', 'children', 'GenerateRFPDocumentModel');
    expect(proposalErrors).toHaveLength(0);
  });

  /** Test Generate Proposal modal opens without errors */
  test('should open generate proposal modal without errors', async ({ page, nav, errorCollector }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    const generateButton = page.locator('button:has-text("Generate Proposal")');
    if (await generateButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await generateButton.click();

      const modalErrors = errorCollector.getErrorsMatching('ReferenceError', 'TypeError');
      expect(modalErrors).toHaveLength(0);
    }
  });
});

test.describe('Sentry Regression: Team Page', () => {
  /** AUTO-RFP-6C: ReferenceError formatDate is not defined */
  test('should load team page without formatDate ReferenceError [AUTO-RFP-6C]', async ({ page, nav, errorCollector }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const teamLink = page.getByRole('link', { name: /team/i });
    if (await teamLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await teamLink.click();
    }

    const formatErrors = errorCollector.getErrorsMatching('ReferenceError', 'formatDate');
    expect(formatErrors).toHaveLength(0);
  });
});

test.describe('Sentry Regression: Opportunities Page', () => {
  /** AUTO-RFP-62/64: SAM.gov 500 error / socket hang up */
  test('should handle SAM.gov errors gracefully [AUTO-RFP-62/64]', async ({ page, nav, errorCollector }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const oppLink = page.getByRole('link', { name: /opportunities|sam\.gov/i });
    if (await oppLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await oppLink.click();

      // Page should show content, not crash
      const hasContent = await page.locator('h1, h2, [data-testid="opportunities-list"], [data-testid="error-message"]').first().isVisible({ timeout: 10000 });
      expect(hasContent).toBeTruthy();
    }

    const criticalErrors = errorCollector.getErrorsMatching('Unhandled', 'socket hang up');
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Sentry Regression: All Pages Load Test', () => {
  /** Comprehensive test that navigates to all major pages and checks for JS errors */
  test('should navigate all major pages without JS errors', async ({ page, errorCollector }) => {
    // Test organizations page
    await page.goto('/organizations');
    await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    // Get first org
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      // No organizations found, skip org-specific tests
      errorCollector.expectNoCriticalErrors();
      return;
    }

    const orgHref = await orgLink.getAttribute('href');
    if (!orgHref) return;

    // Test org dashboard
    await page.goto(orgHref);
    await page.locator('h1, h2').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    // Test knowledge base page
    await page.goto(`${orgHref}/knowledge-base`);
    await page.locator('h1, h2').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    // Test team page
    await page.goto(`${orgHref}/team`);
    await page.locator('h1, h2').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    // Test opportunities page
    await page.goto(`${orgHref}/opportunities`);
    await page.locator('h1, h2').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    // Test settings page
    await page.goto(`${orgHref}/settings`);
    await page.locator('h1, h2').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    // Assert no critical errors across all pages
    errorCollector.expectNoCriticalErrors();
  });
});