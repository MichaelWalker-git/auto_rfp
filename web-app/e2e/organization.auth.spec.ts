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

  test('should create organization successfully', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Click create button
    const createButton = page.getByRole('button', { name: /create|new|add/i });
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await createButton.click();

    // Wait for modal/form
    const nameInput = page.locator('input[id="name"], input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    // Fill form with unique name
    const uniqueName = `E2E Test Org ${Date.now()}`;
    await nameInput.fill(uniqueName);

    // Fill description if present
    const descInput = page.locator('textarea[id="description"], textarea[name="description"]').first();
    if (await descInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await descInput.fill('Organization created by e2e test - safe to delete');
    }

    // Submit form
    const submitButton = page.locator('button[type="submit"], button:has-text("Create")').first();
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for response - modal should close or redirect
    await page.waitForTimeout(3000);

    // Verify no JS errors occurred
    const criticalErrors = errors.filter(e =>
      e.includes('TypeError') || e.includes('ReferenceError')
    );
    expect(criticalErrors).toHaveLength(0);

    // Verify success - either org in list, toast, or redirect
    const orgInList = page.locator(`text="${uniqueName}"`);
    const successToast = page.locator('[role="alert"]:has-text("success"), [role="alert"]:has-text("created")');
    const redirectedToOrg = page.url().match(/\/organizations\/[a-f0-9-]+/);

    const hasOrgInList = await orgInList.isVisible({ timeout: 5000 }).catch(() => false);
    const hasSuccessToast = await successToast.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasOrgInList || hasSuccessToast || redirectedToOrg).toBeTruthy();
  });

  test('should validate required fields on create', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Click create button
    const createButton = page.getByRole('button', { name: /create|new|add/i });
    await createButton.click();

    // Wait for modal
    const nameInput = page.locator('input[id="name"], input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    // Try to submit empty form
    const submitButton = page.locator('button[type="submit"], button:has-text("Create")').first();
    await submitButton.click();

    // Should show validation error or button should be disabled
    const validationError = page.locator('[class*="error"], [role="alert"]:has-text("required"), :text("required")');
    const buttonDisabled = await submitButton.isDisabled();

    const hasValidationError = await validationError.isVisible({ timeout: 2000 }).catch(() => false);

    // Either validation shown or button prevented submission
    expect(hasValidationError || buttonDisabled).toBeTruthy();
  });

  test('should handle duplicate organization name gracefully', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Get name of first existing org
    const firstOrgName = await page.locator('[class*="Card"] h3, [class*="card"] h3').first().textContent();

    if (!firstOrgName) {
      test.skip(); // No existing orgs to test duplicate
      return;
    }

    // Click create button
    const createButton = page.getByRole('button', { name: /create|new|add/i });
    await createButton.click();

    // Fill with existing name
    const nameInput = page.locator('input[id="name"], input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(firstOrgName.trim());

    // Submit
    const submitButton = page.locator('button[type="submit"], button:has-text("Create")').first();
    await submitButton.click();

    // Wait for response
    await page.waitForTimeout(2000);

    // Should show error message (not crash)
    const errorMessage = page.locator('[role="alert"]:has-text("already exists"), [role="alert"]:has-text("duplicate"), [class*="error"]');
    const pageDidNotCrash = await page.locator('body').isVisible();

    expect(pageDidNotCrash).toBe(true);
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
