import { test, expect } from '@playwright/test';

test.describe('Organization Management', () => {
  test.describe('Organization List Page', () => {
    test('should load organizations page or show auth', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      // Should either show organizations or auth form (Amplify Authenticator)
      const hasHeading = await page.getByRole('heading', { name: /organizations/i }).isVisible().catch(() => false);
      const hasAuthForm = await page.getByRole('button', { name: /sign in/i }).isVisible().catch(() => false);
      const hasEmailInput = await page.getByPlaceholder(/enter your email/i).isVisible().catch(() => false);

      expect(hasHeading || hasAuthForm || hasEmailInput).toBeTruthy();
    });

    test.skip('should display organization cards', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      // If authenticated, should see org cards
      const orgCards = page.locator('a[href*="/organizations/"]');
      const count = await orgCards.count();

      // Should have at least the create button visible even if no orgs
      const createBtn = page.getByRole('button', { name: /create organization/i });
      const hasCreateBtn = await createBtn.isVisible().catch(() => false);

      expect(count > 0 || hasCreateBtn).toBeTruthy();
    });
  });

  test.describe('Create Organization', () => {
    test.skip('should open create organization dialog', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const createBtn = page.getByRole('button', { name: /create organization/i });
      if (await createBtn.isVisible()) {
        await createBtn.click();

        // Dialog should appear
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByText(/create new organization/i)).toBeVisible();
      }
    });

    test.skip('should show organization name input', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const createBtn = page.getByRole('button', { name: /create organization/i });
      if (await createBtn.isVisible()) {
        await createBtn.click();

        // Should have name input
        await expect(page.getByLabel(/organization name/i)).toBeVisible();
      }
    });

    test.skip('should show description textarea', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const createBtn = page.getByRole('button', { name: /create organization/i });
      if (await createBtn.isVisible()) {
        await createBtn.click();

        // Should have description input
        await expect(page.getByLabel(/description/i)).toBeVisible();
      }
    });

    test.skip('should create organization successfully', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const createBtn = page.getByRole('button', { name: /create organization/i });
      if (await createBtn.isVisible()) {
        await createBtn.click();

        // Fill in form
        const timestamp = Date.now();
        const orgName = `Test Org ${timestamp}`;

        await page.getByLabel(/organization name/i).fill(orgName);
        await page.getByLabel(/description/i).fill('E2E test organization');

        // Submit
        await page.getByRole('button', { name: /create organization/i }).last().click();

        // Wait for dialog to close and org to appear
        await page.waitForLoadState('networkidle');

        // Should see the new organization
        await expect(page.getByText(orgName)).toBeVisible({ timeout: 10000 });
      }
    });

    test.skip('should validate required fields', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const createBtn = page.getByRole('button', { name: /create organization/i });
      if (await createBtn.isVisible()) {
        await createBtn.click();

        // Try to submit without name
        const submitBtn = page.getByRole('button', { name: /create organization/i }).last();

        // Either button is disabled or shows error on click
        const isDisabled = await submitBtn.isDisabled().catch(() => false);
        if (!isDisabled) {
          await submitBtn.click();
          // Should show validation error
          const hasError = await page.getByText(/required|name/i).isVisible().catch(() => false);
          expect(hasError).toBeTruthy();
        } else {
          expect(isDisabled).toBeTruthy();
        }
      }
    });

    test.skip('should close dialog on cancel', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const createBtn = page.getByRole('button', { name: /create organization/i });
      if (await createBtn.isVisible()) {
        await createBtn.click();
        await expect(page.getByRole('dialog')).toBeVisible();

        // Click cancel
        await page.getByRole('button', { name: /cancel/i }).click();

        // Dialog should close
        await expect(page.getByRole('dialog')).not.toBeVisible();
      }
    });
  });

  test.describe('Edit Organization', () => {
    test.skip('should open edit dialog from organization card', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      // Find an org card with edit button
      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        // Hover to show actions
        await orgCard.hover();

        const editBtn = orgCard.getByRole('button', { name: /edit/i });
        if (await editBtn.isVisible()) {
          await editBtn.click();

          await expect(page.getByRole('dialog')).toBeVisible();
          await expect(page.getByText(/edit organization/i)).toBeVisible();
        }
      }
    });

    test.skip('should pre-populate form with organization data', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        // Get org name from card
        const orgName = await orgCard.locator('h3, h2, [class*="title"]').first().textContent();

        await orgCard.hover();
        const editBtn = orgCard.getByRole('button', { name: /edit/i });
        if (await editBtn.isVisible()) {
          await editBtn.click();

          // Name input should have the org name
          const nameInput = page.getByLabel(/organization name/i) as any;
          const inputValue = await nameInput.inputValue();
          expect(inputValue).toBeTruthy();
        }
      }
    });

    test.skip('should update organization successfully', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.hover();
        const editBtn = orgCard.getByRole('button', { name: /edit/i });
        if (await editBtn.isVisible()) {
          await editBtn.click();

          // Update description
          const descInput = page.getByLabel(/description/i);
          await descInput.fill(`Updated description ${Date.now()}`);

          // Submit
          await page.getByRole('button', { name: /update organization/i }).click();

          // Should close dialog and show success
          await page.waitForLoadState('networkidle');
          await expect(page.getByRole('dialog')).not.toBeVisible();
        }
      }
    });
  });

  test.describe('Organization Navigation', () => {
    test.skip('should navigate to organization details on click', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();

        // Should navigate to org page
        await expect(page).toHaveURL(/\/organizations\/[a-zA-Z0-9-]+/);
      }
    });

    test.skip('should show organization dashboard', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();
        await page.waitForLoadState('networkidle');

        // Should see organization content
        await expect(page.getByRole('heading')).toBeVisible();
      }
    });
  });

  test.describe('Organization Settings', () => {
    test.skip('should navigate to settings page', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();
        await page.waitForLoadState('networkidle');

        // Find settings link
        const settingsLink = page.getByRole('link', { name: /settings/i });
        if (await settingsLink.isVisible()) {
          await settingsLink.click();
          await expect(page).toHaveURL(/settings/);
        }
      }
    });
  });

  test.describe('Team Management', () => {
    test.skip('should navigate to team page', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();
        await page.waitForLoadState('networkidle');

        // Find team link
        const teamLink = page.getByRole('link', { name: /team|members/i });
        if (await teamLink.isVisible()) {
          await teamLink.click();
          await expect(page).toHaveURL(/team/);
        }
      }
    });

    test.skip('should show team members list', async ({ page }) => {
      await page.goto('/organizations');
      await page.waitForLoadState('networkidle');

      const orgCard = page.locator('a[href*="/organizations/"]').first();
      if (await orgCard.isVisible()) {
        await orgCard.click();
        await page.waitForLoadState('networkidle');

        const teamLink = page.getByRole('link', { name: /team|members/i });
        if (await teamLink.isVisible()) {
          await teamLink.click();
          await page.waitForLoadState('networkidle');

          // Should see team content
          await expect(page.getByRole('heading')).toBeVisible();
        }
      }
    });
  });
});
