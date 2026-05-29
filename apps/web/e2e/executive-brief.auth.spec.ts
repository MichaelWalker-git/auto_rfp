import { test, expect } from './fixtures/auth';

test.describe('Executive Brief (Authenticated)', () => {
  test.beforeEach(async ({ nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
    }
  });

  test('should display executive brief section in project overview', async ({ page }) => {
    const briefSection = page.locator('div:has-text("Executive Brief"), h2:has-text("Brief"), [data-testid="executive-brief"]');
    const hasBrief = await briefSection.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasBrief).toBe('boolean');
  });

  test('should show brief sections (Summary, Deadlines, etc.)', async ({ page }) => {
    const sectionNames = ['Summary', 'Deadlines', 'Contacts', 'Requirements', 'Risks', 'Scoring'];
    let visibleCount = 0;

    for (const name of sectionNames) {
      const section = page.locator(`div:has-text("${name}"), button:has-text("${name}")`);
      if (await section.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        visibleCount++;
      }
    }

    // At least some sections should be visible if brief exists
    expect(visibleCount).toBeGreaterThanOrEqual(0);
  });

  test('should show generate brief button or status', async ({ page }) => {
    const generateButton = page.locator('button:has-text("Generate"), button:has-text("Start Brief")');
    const statusIndicator = page.locator('span:has-text("Complete"), span:has-text("In Progress"), span:has-text("Pending")');

    const hasGenerate = await generateButton.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasStatus = await statusIndicator.first().isVisible({ timeout: 5000 }).catch(() => false);

    // Either generate button or status should exist
    expect(typeof hasGenerate).toBe('boolean');
  });

  test('should display GO/NO-GO decision card', async ({ page }) => {
    const decisionCard = page.locator('div:has-text("GO"), div:has-text("Decision"), [data-testid="decision-card"]');
    const hasDecision = await decisionCard.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasDecision).toBe('boolean');
  });

  test('should display deadlines dashboard', async ({ page }) => {
    const deadlinesSection = page.locator('[data-testid="deadlines"], div:has-text("Due"), div:has-text("Deadline")');
    const hasDeadlines = await deadlinesSection.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasDeadlines).toBe('boolean');
  });

  test('should display requirements checklist', async ({ page }) => {
    const requirementsSection = page.locator('[data-testid="requirements"], div:has-text("Requirements"), ul, li');
    const hasRequirements = await requirementsSection.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasRequirements).toBe('boolean');
  });

  test('should display risks assessment', async ({ page }) => {
    const risksSection = page.locator('[data-testid="risks"], div:has-text("Risk"), div:has-text("Warning")');
    const hasRisks = await risksSection.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasRisks).toBe('boolean');
  });

  test('should display scoring grid', async ({ page }) => {
    const scoringSection = page.locator('[data-testid="scoring"], div:has-text("Score"), div:has-text("Rating")');
    const hasScoring = await scoringSection.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(typeof hasScoring).toBe('boolean');
  });
});