import { test, expect, Page } from '@playwright/test';

/**
 * E2E Regression Tests for Sentry Errors
 *
 * These tests are designed to catch and prevent the recurrence of errors
 * reported in Sentry. Each test corresponds to one or more Sentry issues.
 *
 * Sentry Issues Covered:
 * - AUTO-RFP-5V/5W: TypeError reading 'name' on /organizations
 * - AUTO-RFP-6J/6K: ReferenceError useOrganization not defined
 * - AUTO-RFP-6H: ReferenceError useMemo not defined
 * - AUTO-RFP-6C: ReferenceError formatDate not defined
 * - AUTO-RFP-6D: ReferenceError KnowledgeBaseCard not defined
 * - AUTO-RFP-6B: ReferenceError GenerateProposalModal not defined
 * - AUTO-RFP-6A/69: ReferenceError children not defined
 * - AUTO-RFP-68: ReferenceError GlobalHeader not defined
 * - AUTO-RFP-61: ReferenceError useEffect not defined
 * - AUTO-RFP-65: Rage Click on knowledge base page
 */

// Helper to check for JS errors on page
async function collectPageErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
}

// Helper to wait for page without JS errors
async function expectNoJSErrors(page: Page, url: string, timeout = 10000): Promise<void> {
  const errors: string[] = [];
  const errorHandler = (error: Error) => errors.push(error.message);

  page.on('pageerror', errorHandler);

  await page.goto(url);
  await page.waitForLoadState('networkidle', { timeout });

  // Give time for any async errors to surface
  await page.waitForTimeout(1000);

  page.off('pageerror', errorHandler);

  if (errors.length > 0) {
    throw new Error(`JavaScript errors on ${url}:\n${errors.join('\n')}`);
  }
}

test.describe('Sentry Regression: Organization Pages', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  /**
   * AUTO-RFP-5V/5W: TypeError Cannot read properties of undefined (reading 'name')
   * Occurs on /organizations page when organization data is not properly loaded
   */
  test('should load organizations page without TypeError [AUTO-RFP-5V/5W]', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Wait for content to fully render
    await page.waitForTimeout(2000);

    // Check no TypeError occurred
    const typeErrors = errors.filter(e => e.includes('TypeError') || e.includes("reading 'name'"));
    expect(typeErrors).toHaveLength(0);

    // Verify page renders correctly - should show organizations or empty state
    const hasContent = await page.locator('h1, [data-testid="organizations-list"], [data-testid="empty-state"]').first().isVisible();
    expect(hasContent).toBe(true);
  });

  /**
   * AUTO-RFP-6J/6K: ReferenceError useOrganization is not defined
   * Occurs when useOrganization hook is not properly imported
   */
  test('should load projects page without useOrganization ReferenceError [AUTO-RFP-6J/6K]', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Navigate to first org's projects
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (await orgLink.isVisible({ timeout: 5000 })) {
      await orgLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    }

    const referenceErrors = errors.filter(e =>
      e.includes('ReferenceError') && e.includes('useOrganization')
    );
    expect(referenceErrors).toHaveLength(0);
  });

  /**
   * Test organization creation flow (customer-reported issue)
   */
  test('should create organization successfully', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Click create button
    const createButton = page.getByRole('button', { name: /create|new|add/i });
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await createButton.click();

    // Wait for modal
    const nameInput = page.locator('input[id="name"], input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    // Fill form with unique name
    const uniqueName = `Test Org ${Date.now()}`;
    await nameInput.fill(uniqueName);

    // Fill description if present
    const descInput = page.locator('textarea[id="description"], textarea[name="description"]').first();
    if (await descInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await descInput.fill('Test organization created by e2e test');
    }

    // Submit form
    const submitButton = page.locator('button[type="submit"], button:has-text("Create Organization")').first();
    await submitButton.click();

    // Wait for success - modal should close or success toast appears
    await page.waitForTimeout(3000);

    // Check for errors
    const createErrors = errors.filter(e =>
      e.includes('TypeError') || e.includes('ReferenceError') || e.includes('Failed')
    );
    expect(createErrors).toHaveLength(0);

    // Verify org was created (appears in list or success message)
    const successIndicator = page.locator(`text="${uniqueName}"`, { hasText: uniqueName });
    const toastSuccess = page.locator('[role="alert"]:has-text("Success"), [class*="toast"]:has-text("created")');

    const hasOrg = await successIndicator.isVisible({ timeout: 5000 }).catch(() => false);
    const hasToast = await toastSuccess.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasOrg || hasToast).toBe(true);
  });
});

test.describe('Sentry Regression: Knowledge Base Pages', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  /**
   * AUTO-RFP-6D: ReferenceError KnowledgeBaseCard is not defined
   * AUTO-RFP-68: ReferenceError GlobalHeader is not defined
   */
  test('should load knowledge base page without ReferenceErrors [AUTO-RFP-6D/68]', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }))) {
      test.skip();
    }

    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Navigate to knowledge base
    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible({ timeout: 5000 })) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    }

    const referenceErrors = errors.filter(e =>
      e.includes('ReferenceError') &&
      (e.includes('KnowledgeBaseCard') || e.includes('GlobalHeader'))
    );
    expect(referenceErrors).toHaveLength(0);
  });

  /**
   * AUTO-RFP-65: Rage Click on knowledge base page
   * Test that interactive elements respond properly
   */
  test('should respond to clicks without delay [AUTO-RFP-65]', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }))) {
      test.skip();
    }

    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible({ timeout: 5000 })) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Test that buttons are clickable and respond
      const actionButton = page.locator('button').first();
      if (await actionButton.isVisible({ timeout: 5000 })) {
        const startTime = Date.now();
        await actionButton.click();
        const clickDuration = Date.now() - startTime;

        // Click should respond within 500ms to prevent rage clicking
        expect(clickDuration).toBeLessThan(500);
      }
    }
  });
});

test.describe('Sentry Regression: Documents Page', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  /**
   * AUTO-RFP-6H: ReferenceError useMemo is not defined
   * AUTO-RFP-61: ReferenceError useEffect is not defined
   */
  test('should load documents page without hook ReferenceErrors [AUTO-RFP-6H/61]', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }))) {
      test.skip();
    }

    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Navigate to a project with documents
    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (await projectLink.isVisible({ timeout: 5000 })) {
      await projectLink.click();
      await page.waitForLoadState('networkidle');

      // Navigate to documents tab
      const documentsLink = page.locator('a[href*="/documents"], button:has-text("Documents")').first();
      if (await documentsLink.isVisible({ timeout: 5000 })) {
        await documentsLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
      }
    }

    const hookErrors = errors.filter(e =>
      e.includes('ReferenceError') &&
      (e.includes('useMemo') || e.includes('useEffect'))
    );
    expect(hookErrors).toHaveLength(0);
  });
});

test.describe('Sentry Regression: Proposals Page', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  /**
   * AUTO-RFP-6A/69: ReferenceError children is not defined
   * AUTO-RFP-6B: ReferenceError GenerateProposalModal is not defined
   * AUTO-RFP-6G: ProposalsContent.tsx compilation error
   */
  test('should load proposals page without ReferenceErrors [AUTO-RFP-6A/69/6B/6G]', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }))) {
      test.skip();
    }

    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Navigate to a project
    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (await projectLink.isVisible({ timeout: 5000 })) {
      await projectLink.click();
      await page.waitForLoadState('networkidle');

      // Navigate to proposals
      const proposalsLink = page.locator('a[href*="/proposals"], button:has-text("Proposals")').first();
      if (await proposalsLink.isVisible({ timeout: 5000 })) {
        await proposalsLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
      }
    }

    const proposalErrors = errors.filter(e =>
      e.includes('ReferenceError') &&
      (e.includes('children') || e.includes('GenerateProposalModal'))
    );
    expect(proposalErrors).toHaveLength(0);
  });

  /**
   * Test Generate Proposal modal opens without errors
   */
  test('should open generate proposal modal without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }))) {
      test.skip();
    }

    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (await projectLink.isVisible({ timeout: 5000 })) {
      await projectLink.click();
      await page.waitForLoadState('networkidle');

      // Look for generate proposal button
      const generateButton = page.locator('button:has-text("Generate Proposal")');
      if (await generateButton.isVisible({ timeout: 5000 })) {
        await generateButton.click();
        await page.waitForTimeout(1000);

        // Modal should open without errors
        const modalErrors = errors.filter(e => e.includes('ReferenceError') || e.includes('TypeError'));
        expect(modalErrors).toHaveLength(0);
      }
    }
  });
});

test.describe('Sentry Regression: Team Page', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  /**
   * AUTO-RFP-6C: ReferenceError formatDate is not defined
   */
  test('should load team page without formatDate ReferenceError [AUTO-RFP-6C]', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }))) {
      test.skip();
    }

    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Navigate to team page
    const teamLink = page.getByRole('link', { name: /team/i });
    if (await teamLink.isVisible({ timeout: 5000 })) {
      await teamLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    }

    const formatErrors = errors.filter(e =>
      e.includes('ReferenceError') && e.includes('formatDate')
    );
    expect(formatErrors).toHaveLength(0);
  });
});

test.describe('Sentry Regression: Opportunities Page', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  /**
   * AUTO-RFP-62: SAM.gov 500 error handling
   * AUTO-RFP-64: socket hang up error
   */
  test('should handle SAM.gov errors gracefully [AUTO-RFP-62/64]', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }))) {
      test.skip();
    }

    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Navigate to opportunities
    const oppLink = page.getByRole('link', { name: /opportunities|sam\.gov/i });
    if (await oppLink.isVisible({ timeout: 5000 })) {
      await oppLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Page should show either results or a user-friendly error message
      // NOT an unhandled exception
      const hasContent = await page.locator('h1, h2, [data-testid="opportunities-list"], [data-testid="error-message"]').first().isVisible();
      expect(hasContent).toBe(true);
    }

    // Verify no unhandled socket/network errors crashed the page
    const criticalErrors = errors.filter(e =>
      e.includes('Unhandled') || e.includes('socket hang up')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Sentry Regression: All Pages Load Test', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  /**
   * Comprehensive test that navigates to all major pages and checks for JS errors
   * This catches any ReferenceErrors from missing imports in production builds
   */
  test('should navigate all major pages without JS errors', async ({ page }) => {
    const pageErrors: { url: string; errors: string[] }[] = [];

    const collectErrors = () => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      return errors;
    };

    // Test organizations page
    let errors = collectErrors();
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    if (errors.length > 0) pageErrors.push({ url: '/organizations', errors: [...errors] });

    // Get first org
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }))) {
      console.log('No organizations found, skipping org-specific tests');
      return;
    }

    const orgHref = await orgLink.getAttribute('href');
    if (!orgHref) return;

    // Test org dashboard
    errors = collectErrors();
    await page.goto(orgHref);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    if (errors.length > 0) pageErrors.push({ url: orgHref, errors: [...errors] });

    // Test knowledge base page
    errors = collectErrors();
    await page.goto(`${orgHref}/knowledge-base`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    if (errors.length > 0) pageErrors.push({ url: `${orgHref}/knowledge-base`, errors: [...errors] });

    // Test team page
    errors = collectErrors();
    await page.goto(`${orgHref}/team`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    if (errors.length > 0) pageErrors.push({ url: `${orgHref}/team`, errors: [...errors] });

    // Test opportunities page
    errors = collectErrors();
    await page.goto(`${orgHref}/opportunities`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    if (errors.length > 0) pageErrors.push({ url: `${orgHref}/opportunities`, errors: [...errors] });

    // Test settings page
    errors = collectErrors();
    await page.goto(`${orgHref}/settings`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    if (errors.length > 0) pageErrors.push({ url: `${orgHref}/settings`, errors: [...errors] });

    // Report all errors
    if (pageErrors.length > 0) {
      const errorReport = pageErrors
        .map(pe => `${pe.url}:\n  ${pe.errors.join('\n  ')}`)
        .join('\n\n');
      throw new Error(`JavaScript errors found:\n${errorReport}`);
    }
  });
});
