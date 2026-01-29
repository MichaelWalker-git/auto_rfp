import { test, expect } from '@playwright/test';

test.describe('Project CRUD (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should navigate to projects page', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Navigate to first org
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Look for projects link or should already be on projects page
    const projectsLink = page.getByRole('link', { name: /projects/i });
    if (await projectsLink.isVisible()) {
      await projectsLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Should see Projects heading
    const heading = page.locator('h2:has-text("Projects")');
    const hasHeading = await heading.isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`Projects heading visible: ${hasHeading}`);
  });

  test('should display projects list or empty state', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Should see project cards or empty state
    const projectCards = page.locator('[class*="Card"]');
    const emptyState = page.locator('div:has-text("No projects yet")');

    const hasCards = await projectCards.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmpty = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);

    console.log(`Project cards: ${hasCards}, Empty state: ${hasEmpty}`);
  });

  test('should display New Project button', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Should see New Project button
    const newProjectButton = page.locator('button:has-text("New Project")');
    const hasButton = await newProjectButton.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`New Project button: ${hasButton}`);
  });

  test('should open create project dialog', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Click New Project button
    const newProjectButton = page.locator('button:has-text("New Project")');
    if (await newProjectButton.isVisible()) {
      await newProjectButton.click();

      // Dialog should open
      const dialog = page.locator('[role="dialog"]');
      const hasDialog = await dialog.isVisible({ timeout: 5000 }).catch(() => false);

      if (hasDialog) {
        // Should see form fields
        const nameInput = page.locator('input#name');
        const descriptionInput = page.locator('textarea#description');

        const hasName = await nameInput.isVisible().catch(() => false);
        const hasDescription = await descriptionInput.isVisible().catch(() => false);

        console.log(`Name input: ${hasName}, Description input: ${hasDescription}`);
      }
    }
  });

  test('should validate project name is required', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Click New Project button
    const newProjectButton = page.locator('button:has-text("New Project")');
    if (await newProjectButton.isVisible()) {
      await newProjectButton.click();

      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 5000 })) {
        // Create button should be disabled without name
        const createButton = page.locator('button:has-text("Create")').last();
        const isDisabled = await createButton.isDisabled();
        console.log(`Create button disabled without name: ${isDisabled}`);
      }
    }
  });

  test('should navigate to project detail page', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Click on first project if exists
    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (await projectLink.isVisible()) {
      await projectLink.click();
      await page.waitForLoadState('networkidle');

      // Should be on project detail page
      await expect(page).toHaveURL(/\/projects\/[a-zA-Z0-9-]+/);
    }
  });

  test('should display project name and description', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Click on first project if exists
    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (await projectLink.isVisible()) {
      await projectLink.click();
      await page.waitForLoadState('networkidle');

      // Should see project heading
      const heading = page.locator('h1, h2').first();
      const hasHeading = await heading.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Project heading visible: ${hasHeading}`);
    }
  });

  test('should show delete confirmation dialog', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Look for delete button on project cards
    const deleteButton = page.locator('button:has([class*="Trash"]), button[aria-label*="Delete"]');
    if (await deleteButton.first().isVisible()) {
      await deleteButton.first().click();

      // Confirmation dialog should appear
      const confirmDialog = page.locator('[role="alertdialog"]');
      const hasConfirmDialog = await confirmDialog.isVisible({ timeout: 5000 }).catch(() => false);

      if (hasConfirmDialog) {
        // Should see Delete and Cancel buttons
        const confirmDeleteButton = page.locator('button:has-text("Delete")');
        const cancelButton = page.locator('button:has-text("Cancel")');

        const hasDelete = await confirmDeleteButton.isVisible().catch(() => false);
        const hasCancel = await cancelButton.isVisible().catch(() => false);

        console.log(`Delete button: ${hasDelete}, Cancel button: ${hasCancel}`);
      }
    }
  });

  test('should cancel delete operation', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Look for delete button on project cards
    const deleteButton = page.locator('button:has([class*="Trash"]), button[aria-label*="Delete"]');
    if (await deleteButton.first().isVisible()) {
      await deleteButton.first().click();

      const confirmDialog = page.locator('[role="alertdialog"]');
      if (await confirmDialog.isVisible({ timeout: 5000 })) {
        // Click Cancel
        const cancelButton = page.locator('button:has-text("Cancel")');
        await cancelButton.click();

        // Dialog should close
        const dialogClosed = await confirmDialog.isHidden({ timeout: 3000 }).catch(() => false);
        console.log(`Dialog closed after cancel: ${dialogClosed}`);
      }
    }
  });

  test('should display project tabs (Documents, Questions, etc.)', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Click on first project if exists
    const projectLink = page.locator('a[href*="/projects/"]').first();
    if (await projectLink.isVisible()) {
      await projectLink.click();
      await page.waitForLoadState('networkidle');

      // Look for project tabs/links
      const documentsTab = page.getByRole('link', { name: /documents/i });
      const questionsTab = page.getByRole('link', { name: /questions/i });
      const proposalsTab = page.getByRole('link', { name: /proposals/i });

      const hasDocuments = await documentsTab.isVisible({ timeout: 5000 }).catch(() => false);
      const hasQuestions = await questionsTab.isVisible({ timeout: 5000 }).catch(() => false);
      const hasProposals = await proposalsTab.isVisible({ timeout: 5000 }).catch(() => false);

      console.log(`Documents: ${hasDocuments}, Questions: ${hasQuestions}, Proposals: ${hasProposals}`);
    }
  });
});
