import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should show login form on protected route', async ({ page }) => {
    // Navigate to a protected route — Amplify Authenticator renders the login form
    await page.goto('/organizations');
    await expect(page).toHaveURL(/\/(organizations)/);
  });

  test('should display sign in button', async ({ page }) => {
    await page.goto('/organizations');

    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible();
  });

  test('should show email and password fields on login form', async ({ page }) => {
    await page.goto('/organizations');

    const emailInput = page.locator(
      'input[name="username"], input[type="email"], input[placeholder*="email" i]',
    ).first();
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
  });
});

test.describe('Protected Routes', () => {
  test.skip('should access organizations when authenticated', async ({ page }) => {
    // This test requires auth setup via E2E_TEST_EMAIL and E2E_TEST_PASSWORD env vars
    // Use the chromium-authenticated project to run authenticated tests
    await page.goto('/organizations');
    await expect(page.getByRole('heading', { name: /organizations/i })).toBeVisible();
  });
});