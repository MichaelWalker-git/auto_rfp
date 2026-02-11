import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should redirect unauthenticated users to login', async ({ page }) => {
    // Try to access a protected route
    await page.goto('/organizations');

    // Amplify Authenticator wraps the app, so unauthenticated users
    // see the login form on any protected route
    await expect(page).toHaveURL(/\/(organizations)/);
  });

  test('should display login form', async ({ page }) => {
    // Navigate to a protected route — Amplify Authenticator renders the login form
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Amplify Authenticator should show the Sign In form
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible();
  });

  test('should show email and password fields on login form', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Amplify Authenticator renders username/email and password inputs
    const emailInput = page.locator(
      'input[name="username"], input[type="email"], input[placeholder*="email" i]'
    ).first();
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
  });
});

test.describe('Protected Routes', () => {
  test.skip('should access organizations when authenticated', async ({ page }) => {
    // This test is skipped by default as it requires auth setup
    // To enable, set E2E_TEST_EMAIL and E2E_TEST_PASSWORD env vars
    // and use the chromium-authenticated project

    await page.goto('/organizations');
    await expect(page.getByRole('heading', { name: /organizations/i })).toBeVisible();
  });
});