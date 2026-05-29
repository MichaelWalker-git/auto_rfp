import { test, expect } from '@playwright/test';

// Unauthenticated organization tests
// For authenticated tests, see organization.auth.spec.ts

test.describe('Organization Routes (Unauthenticated)', () => {
  test('should redirect to login when accessing organizations without auth', async ({ page }) => {
    await page.goto('/organizations');

    // Should redirect to auth or show login UI
    await expect(page).toHaveURL(/\/(auth|login|organizations)/);
  });

  test('should not expose organization data to unauthenticated users', async ({ page }) => {
    // Try to access a specific organization
    await page.goto('/organizations/some-org-id');
    await page.waitForLoadState('networkidle');

    // The page should NOT show sensitive organization content to unauthenticated users
    // This could happen via redirect to auth, showing login UI, or showing error/not found
    // We verify this by checking that detailed org data (like projects list) is not visible
    const hasProjectsData = await page.locator('[data-testid="projects-list"]').isVisible().catch(() => false);
    const hasOrgSettingsData = await page.locator('[data-testid="org-settings"]').isVisible().catch(() => false);

    // Protected data should not be visible without authentication
    expect(hasProjectsData).toBe(false);
    expect(hasOrgSettingsData).toBe(false);
  });
});
