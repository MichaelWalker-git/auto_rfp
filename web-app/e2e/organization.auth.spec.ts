import { test, expect } from '@playwright/test';

test.describe('Organization Management (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    // Skip if not authenticated (no E2E_TEST_EMAIL set)
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should display organization list', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Check for organizations heading or list container
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
  });

  test('should show create organization button', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Look for create button
    const createButton = page.getByRole('button', { name: /create|new|add/i });
    await expect(createButton).toBeVisible();
  });

  test('should open create organization modal', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Click create button
    const createButton = page.getByRole('button', { name: /create|new|add/i });
    await createButton.click();

    // Modal or form should appear
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to organization details', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Click on first organization card/link
    const orgLink = page.locator('a[href*="/organizations/"]').first();

    if (await orgLink.isVisible()) {
      await orgLink.click();
      // Should navigate to organization page
      await expect(page).toHaveURL(/\/organizations\/[a-zA-Z0-9-]+/);
    } else {
      // No organizations exist yet - that's okay
      test.skip();
    }
  });
});

test.describe('Project Management (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should display projects within organization', async ({ page }) => {
    // First navigate to organizations and get a valid org
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();

    if (await orgLink.isVisible()) {
      await orgLink.click();
      await page.waitForLoadState('networkidle');

      // Should see projects section or empty state
      const projectsSection = page.locator('[data-testid="projects"], h2:has-text("Projects"), h3:has-text("Projects")');
      const emptyState = page.getByText(/no projects|create.*project|get started/i);

      const hasProjects = await projectsSection.isVisible().catch(() => false);
      const hasEmptyState = await emptyState.isVisible().catch(() => false);

      expect(hasProjects || hasEmptyState).toBe(true);
    } else {
      test.skip();
    }
  });

  test('should show create project button', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();

    if (await orgLink.isVisible()) {
      await orgLink.click();
      await page.waitForLoadState('networkidle');

      // Look for create project button
      const createButton = page.getByRole('button', { name: /create.*project|new.*project/i });
      await expect(createButton).toBeVisible();
    } else {
      test.skip();
    }
  });
});
