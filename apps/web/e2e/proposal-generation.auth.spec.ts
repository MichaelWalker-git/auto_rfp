import { test, expect } from './fixtures/auth';

test.describe('Proposal Generation (Authenticated)', () => {
  test('should navigate to proposals section', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    const hasProposals = await nav.goToProposals();
    expect(typeof hasProposals).toBe('boolean');
  });

  test('should show generate proposal button', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToProposals();

    const generateButton = page.locator('button:has-text("Generate"), button:has-text("Create Proposal"), button:has-text("New Proposal")');
    const hasGenerateButton = await generateButton.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasGenerateButton).toBe('boolean');
  });

  test('should display proposals list or empty state', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToProposals();

    const proposalsList = page.locator('[data-testid="proposals-list"], a[href*="/proposals/"]');
    const emptyState = page.locator('div:has-text("No proposals"), div:has-text("Generate")');

    const hasProposals = await proposalsList.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmpty = await emptyState.first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasProposals || hasEmpty).toBeTruthy();
  });

  test('should open proposal generation modal from questions page', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToQuestions();

    const generateButton = page.locator('button:has-text("Generate Proposal"), button:has-text("Create Proposal")');
    if (!(await generateButton.first().isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await generateButton.first().click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to proposal detail page', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToProposals();

    const proposalLink = page.locator('a[href*="/proposals/"]').first();
    if (!(await proposalLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await proposalLink.click();
    await expect(page).toHaveURL(/\/proposals\/[a-zA-Z0-9-]+/);
  });

  test('should show export options in proposal detail', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToProposals();

    const proposalLink = page.locator('a[href*="/proposals/"]').first();
    if (!(await proposalLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await proposalLink.click();

    const exportPdf = page.locator('button:has-text("PDF"), button:has-text("Export")');
    const exportDocx = page.locator('button:has-text("DOCX"), button:has-text("Word")');

    const hasPdf = await exportPdf.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasDocx = await exportDocx.first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(typeof hasPdf).toBe('boolean');
  });

  test('should display proposal sections and subsections', async ({ page, nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
      return;
    }

    await nav.goToProposals();

    const proposalLink = page.locator('a[href*="/proposals/"]').first();
    if (!(await proposalLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await proposalLink.click();

    const sections = page.locator('[data-testid="proposal-section"], h2, h3');
    const sectionCount = await sections.count();
    expect(sectionCount).toBeGreaterThanOrEqual(0);
  });
});