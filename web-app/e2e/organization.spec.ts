import { test, expect } from '@playwright/test';

test.describe('Organization Management', () => {
  // These tests are designed to work with an authenticated user
  // They're currently skipped as they require auth setup

  test.skip('should display organization list', async ({ page }) => {
    await page.goto('/organizations');

    // Check for organizations heading or list
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test.skip('should create a new organization', async ({ page }) => {
    await page.goto('/organizations');

    // Click create button
    const createButton = page.getByRole('button', { name: /create organization/i });
    await createButton.click();

    // Fill in organization form
    await page.fill('input[name="name"]', 'Test Organization');
    await page.fill('textarea[name="description"]', 'A test organization description');

    // Submit form
    await page.getByRole('button', { name: /create/i }).click();

    // Verify organization was created
    await expect(page.getByText('Test Organization')).toBeVisible();
  });

  test.skip('should navigate to organization details', async ({ page }) => {
    await page.goto('/organizations');

    // Click on an organization (assuming at least one exists)
    const orgCard = page.locator('[data-testid="organization-card"]').first();
    await orgCard.click();

    // Should navigate to organization page
    await expect(page).toHaveURL(/\/organizations\/[a-zA-Z0-9-]+/);
  });
});

test.describe('Project Management', () => {
  test.skip('should display project list within organization', async ({ page }) => {
    // Navigate to a specific organization
    await page.goto('/organizations/test-org-id');

    // Check for projects list
    const projectsList = page.locator('[data-testid="projects-list"]');
    await expect(projectsList).toBeVisible();
  });

  test.skip('should create a new project', async ({ page }) => {
    await page.goto('/organizations/test-org-id');

    // Click create project button
    const createButton = page.getByRole('button', { name: /create project/i });
    await createButton.click();

    // Fill in project form
    await page.fill('input[name="name"]', 'Test RFP Project');
    await page.fill('textarea[name="description"]', 'A test RFP project');

    // Submit
    await page.getByRole('button', { name: /create/i }).click();

    // Verify project was created
    await expect(page.getByText('Test RFP Project')).toBeVisible();
  });
});
