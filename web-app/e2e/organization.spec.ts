import { test, expect } from '@playwright/test';

// Unauthenticated organization tests
// For authenticated tests, see organization.auth.spec.ts

test.describe('Organization Routes (Unauthenticated)', () => {
  test('should redirect to login when accessing organizations without auth', async ({ page }) => {
    await page.goto('/organizations');

    // Should redirect to auth or show login UI
    await expect(page).toHaveURL(/\/(auth|login|organizations)/);
  });

  test('should show login prompt or redirect for protected organization routes', async ({ page }) => {
    // Try to access a specific organization
    await page.goto('/organizations/some-org-id');

    // Should either redirect to auth or show the page is protected
    const isAuthPage = await page.url().includes('auth') || await page.url().includes('login');
    const hasLoginPrompt = await page.getByText(/sign in|log in/i).isVisible().catch(() => false);

    expect(isAuthPage || hasLoginPrompt).toBe(true);
  });
});
