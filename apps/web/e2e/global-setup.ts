import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '.auth/user.json');

setup('authenticate', async ({ page }) => {
  // Check if we have test credentials
  const testEmail = process.env.E2E_TEST_EMAIL;
  const testPassword = process.env.E2E_TEST_PASSWORD;

  if (!testEmail || !testPassword) {
    console.log('⚠️  E2E_TEST_EMAIL and E2E_TEST_PASSWORD not set');
    console.log('   Authenticated tests will be skipped');
    // Create empty auth file so tests can still run
    await page.context().storageState({ path: authFile });
    return;
  }

  console.log('🔐 Setting up authentication...');

  // Navigate to a protected route — Amplify Authenticator renders the login form
  await page.goto('/organizations');
  await page.waitForLoadState('networkidle');

  // Look for the email/username input (Amplify uses different field names)
  const emailInput = page.locator('input[name="username"], input[type="email"], input[placeholder*="email" i]').first();
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();

  // Wait for inputs to be visible
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await passwordInput.waitFor({ state: 'visible', timeout: 10000 });

  // Fill in credentials
  await emailInput.fill(testEmail);
  await passwordInput.fill(testPassword);

  // Find and click the sign in button
  const signInButton = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Sign In")').first();
  await signInButton.click();

  // Wait for successful login - should redirect to organizations or dashboard
  await page.waitForURL(/\/(organizations|dashboard)/, { timeout: 30000 });

  // The login form renders in place on /organizations, so the URL check alone can
  // pass before Amplify persists tokens. Wait for an authenticated-only element
  // (the page heading) so localStorage tokens exist when we snapshot state.
  await page
    .getByRole('heading', { level: 1 })
    .waitFor({ state: 'visible', timeout: 30000 });

  console.log('✅ Authentication successful');

  // Save storage state (cookies, localStorage)
  await page.context().storageState({ path: authFile });

  console.log(`✅ Auth state saved to ${authFile}`);
});
