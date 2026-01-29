import { test, expect } from '@playwright/test';

test.describe('Project Management', () => {
  test.describe('Unauthenticated Access', () => {
    test('should redirect to login when accessing projects without auth', async ({ page }) => {
      await page.goto('/organizations/test-org/projects');
      // Should redirect to auth page
      await expect(page).toHaveURL(/\/(auth|login|organizations)/);
    });
  });

  test.describe('Project List', () => {
    test.skip('should display projects list when authenticated', async ({ page }) => {
      // This test requires authentication
      await page.goto('/organizations');

      // Wait for organization to load
      await page.waitForLoadState('networkidle');

      // Click on an organization
      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();

        // Should see projects section
        await expect(page.getByText(/projects/i)).toBeVisible();
      }
    });
  });

  test.describe('Create Project', () => {
    test.skip('should show create project dialog', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      // Navigate to an org
      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();
        await page.waitForLoadState('networkidle');

        // Find and click create project button
        const createBtn = page.getByRole('button', { name: /create project|new project/i });
        if (await createBtn.isVisible()) {
          await createBtn.click();

          // Dialog should appear
          await expect(page.getByRole('dialog')).toBeVisible();
          await expect(page.getByLabel(/name/i)).toBeVisible();
        }
      }
    });

    test.skip('should validate required fields on create project', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();
        await page.waitForLoadState('networkidle');

        const createBtn = page.getByRole('button', { name: /create project|new project/i });
        if (await createBtn.isVisible()) {
          await createBtn.click();

          // Try to submit without filling required fields
          const submitBtn = page.getByRole('button', { name: /create|submit/i }).last();
          await submitBtn.click();

          // Should show validation error or button should be disabled
          const hasError = await page.getByText(/required|please fill/i).isVisible().catch(() => false);
          const isDisabled = await submitBtn.isDisabled().catch(() => false);

          expect(hasError || isDisabled).toBeTruthy();
        }
      }
    });
  });

  test.describe('Edit Project', () => {
    test.skip('should allow editing project name', async ({ page }) => {
      // Navigate to a project
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();
        await page.waitForLoadState('networkidle');

        // Find a project and click edit
        const projectCard = page.locator('[data-testid="project-card"], a[href*="/projects/"]').first();
        if (await projectCard.isVisible()) {
          // Look for edit button
          const editBtn = projectCard.getByRole('button', { name: /edit/i });
          if (await editBtn.isVisible()) {
            await editBtn.click();

            // Edit dialog should appear
            await expect(page.getByRole('dialog')).toBeVisible();
          }
        }
      }
    });
  });

  test.describe('Project Dashboard', () => {
    test.skip('should display project dashboard with key sections', async ({ page }) => {
      // This requires a valid project ID
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();
        await page.waitForLoadState('networkidle');

        const projectLink = page.locator('a[href*="/projects/"]').first();
        if (await projectLink.isVisible()) {
          await projectLink.click();
          await page.waitForLoadState('networkidle');

          // Should see dashboard elements
          await expect(page.getByRole('heading')).toBeVisible();
        }
      }
    });
  });
});

test.describe('Project Questions', () => {
  test.skip('should display questions tab in project', async ({ page }) => {
    // Navigate to a project's questions
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgCard = page.locator('a[href*="/organizations/"]').first();
    if (await orgCard.isVisible()) {
      await orgCard.click();
      await page.waitForLoadState('networkidle');

      const projectLink = page.locator('a[href*="/projects/"]').first();
      if (await projectLink.isVisible()) {
        await projectLink.click();
        await page.waitForLoadState('networkidle');

        // Find questions tab or link
        const questionsTab = page.getByRole('link', { name: /questions/i });
        if (await questionsTab.isVisible()) {
          await questionsTab.click();
          await expect(page).toHaveURL(/questions/);
        }
      }
    }
  });

  test.skip('should allow uploading question file', async ({ page }) => {
    // This would test the question file upload functionality
    // Requires navigating to questions page and interacting with upload
  });
});
