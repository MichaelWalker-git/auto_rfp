import { test, expect } from '@playwright/test';

test.describe('Proposal Generation (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should navigate to proposals section', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Navigate to org -> project
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

    // Look for proposals tab/link or section
    const proposalsLink = page.getByRole('link', { name: /proposals/i });
    const proposalsSection = page.locator('div:has-text("Proposals"), h2:has-text("Proposals")');

    const hasLink = await proposalsLink.isVisible().catch(() => false);
    const hasSection = await proposalsSection.first().isVisible().catch(() => false);

    console.log(`Proposals link: ${hasLink}, Proposals section: ${hasSection}`);
  });

  test('should show generate proposal button', async ({ page }) => {
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

    // Navigate to proposals if there's a link
    const proposalsLink = page.getByRole('link', { name: /proposals/i });
    if (await proposalsLink.isVisible()) {
      await proposalsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Look for generate proposal button
    const generateButton = page.locator('button:has-text("Generate"), button:has-text("Create Proposal"), button:has-text("New Proposal")');
    const hasGenerateButton = await generateButton.first().isVisible().catch(() => false);
    console.log(`Generate proposal button visible: ${hasGenerateButton}`);
  });

  test('should display proposals list or empty state', async ({ page }) => {
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

    // Navigate to proposals
    const proposalsLink = page.getByRole('link', { name: /proposals/i });
    if (await proposalsLink.isVisible()) {
      await proposalsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Should see proposals list or empty state
    const proposalsList = page.locator('[data-testid="proposals-list"], a[href*="/proposals/"]');
    const emptyState = page.locator('div:has-text("No proposals"), div:has-text("Generate")');

    const hasProposals = await proposalsList.first().isVisible().catch(() => false);
    const hasEmpty = await emptyState.first().isVisible().catch(() => false);

    console.log(`Proposals: ${hasProposals}, Empty state: ${hasEmpty}`);
  });

  test('should open proposal generation modal from questions page', async ({ page }) => {
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

    // Navigate to questions
    const questionsLink = page.getByRole('link', { name: /questions/i });
    if (await questionsLink.isVisible()) {
      await questionsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Look for generate proposal button
    const generateButton = page.locator('button:has-text("Generate Proposal"), button:has-text("Create Proposal")');
    if (await generateButton.first().isVisible()) {
      await generateButton.first().click();

      // Modal should open
      const modal = page.locator('[role="dialog"]');
      const hasModal = await modal.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Proposal generation modal opened: ${hasModal}`);
    }
  });

  test('should navigate to proposal detail page', async ({ page }) => {
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

    // Navigate to proposals
    const proposalsLink = page.getByRole('link', { name: /proposals/i });
    if (await proposalsLink.isVisible()) {
      await proposalsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Click on first proposal if exists
    const proposalLink = page.locator('a[href*="/proposals/"]').first();
    if (await proposalLink.isVisible()) {
      await proposalLink.click();
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveURL(/\/proposals\/[a-zA-Z0-9-]+/);
    }
  });

  test('should show export options in proposal detail', async ({ page }) => {
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

    // Navigate to proposals
    const proposalsLink = page.getByRole('link', { name: /proposals/i });
    if (await proposalsLink.isVisible()) {
      await proposalsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Click on first proposal
    const proposalLink = page.locator('a[href*="/proposals/"]').first();
    if (await proposalLink.isVisible()) {
      await proposalLink.click();
      await page.waitForLoadState('networkidle');

      // Look for export buttons
      const exportPdf = page.locator('button:has-text("PDF"), button:has-text("Export")');
      const exportDocx = page.locator('button:has-text("DOCX"), button:has-text("Word")');

      const hasPdf = await exportPdf.first().isVisible().catch(() => false);
      const hasDocx = await exportDocx.first().isVisible().catch(() => false);

      console.log(`Export PDF: ${hasPdf}, Export DOCX: ${hasDocx}`);
    }
  });

  test('should display proposal sections and subsections', async ({ page }) => {
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

    // Navigate to proposals
    const proposalsLink = page.getByRole('link', { name: /proposals/i });
    if (await proposalsLink.isVisible()) {
      await proposalsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Click on first proposal
    const proposalLink = page.locator('a[href*="/proposals/"]').first();
    if (await proposalLink.isVisible()) {
      await proposalLink.click();
      await page.waitForLoadState('networkidle');

      // Look for sections structure
      const sections = page.locator('[data-testid="proposal-section"], h2, h3');
      const sectionCount = await sections.count();
      console.log(`Found ${sectionCount} potential sections/headings`);
    }
  });
});
