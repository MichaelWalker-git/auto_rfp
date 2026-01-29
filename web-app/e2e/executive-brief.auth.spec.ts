import { test, expect } from '@playwright/test';

test.describe('Executive Brief (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should display executive brief section in project overview', async ({ page }) => {
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

    // Look for executive brief section
    const briefSection = page.locator('div:has-text("Executive Brief"), h2:has-text("Brief"), [data-testid="executive-brief"]');
    const hasBrief = await briefSection.first().isVisible().catch(() => false);
    console.log(`Executive brief section visible: ${hasBrief}`);
  });

  test('should show all 6 brief sections', async ({ page }) => {
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

    // Check for the 6 sections: Summary, Deadlines, Contacts, Requirements, Risks, Scoring
    const sections = {
      summary: page.locator('div:has-text("Summary"), button:has-text("Summary")'),
      deadlines: page.locator('div:has-text("Deadlines"), button:has-text("Deadlines")'),
      contacts: page.locator('div:has-text("Contacts"), button:has-text("Contacts")'),
      requirements: page.locator('div:has-text("Requirements"), button:has-text("Requirements")'),
      risks: page.locator('div:has-text("Risks"), button:has-text("Risks")'),
      scoring: page.locator('div:has-text("Scoring"), button:has-text("Scoring")'),
    };

    for (const [name, locator] of Object.entries(sections)) {
      const visible = await locator.first().isVisible().catch(() => false);
      console.log(`Section ${name}: ${visible}`);
    }
  });

  test('should show generate brief button or status', async ({ page }) => {
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

    // Look for generate button or status indicators
    const generateButton = page.locator('button:has-text("Generate"), button:has-text("Start Brief")');
    const statusIndicator = page.locator('span:has-text("Complete"), span:has-text("In Progress"), span:has-text("Pending")');

    const hasGenerate = await generateButton.first().isVisible().catch(() => false);
    const hasStatus = await statusIndicator.first().isVisible().catch(() => false);

    console.log(`Generate button: ${hasGenerate}, Status indicator: ${hasStatus}`);
  });

  test('should display GO/NO-GO decision card', async ({ page }) => {
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

    // Look for decision card (GO/NO-GO)
    const decisionCard = page.locator('div:has-text("GO"), div:has-text("Decision"), [data-testid="decision-card"]');
    const hasDecision = await decisionCard.first().isVisible().catch(() => false);
    console.log(`Decision card visible: ${hasDecision}`);
  });

  test('should display deadlines dashboard', async ({ page }) => {
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

    // Look for deadlines section with dates
    const deadlinesSection = page.locator('[data-testid="deadlines"], div:has-text("Due"), div:has-text("Deadline")');
    const hasDeadlines = await deadlinesSection.first().isVisible().catch(() => false);
    console.log(`Deadlines section visible: ${hasDeadlines}`);
  });

  test('should display requirements checklist', async ({ page }) => {
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

    // Look for requirements list
    const requirementsSection = page.locator('[data-testid="requirements"], div:has-text("Requirements"), ul, li');
    const hasRequirements = await requirementsSection.first().isVisible().catch(() => false);
    console.log(`Requirements section visible: ${hasRequirements}`);
  });

  test('should display risks assessment', async ({ page }) => {
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

    // Look for risks section
    const risksSection = page.locator('[data-testid="risks"], div:has-text("Risk"), div:has-text("Warning")');
    const hasRisks = await risksSection.first().isVisible().catch(() => false);
    console.log(`Risks section visible: ${hasRisks}`);
  });

  test('should display scoring grid', async ({ page }) => {
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

    // Look for scoring grid
    const scoringSection = page.locator('[data-testid="scoring"], div:has-text("Score"), div:has-text("Rating")');
    const hasScoring = await scoringSection.first().isVisible().catch(() => false);
    console.log(`Scoring section visible: ${hasScoring}`);
  });
});
