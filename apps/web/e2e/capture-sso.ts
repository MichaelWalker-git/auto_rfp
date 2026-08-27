/**
 * One-off SSO session capture for Playwright.
 *
 * The email/password flow in `global-setup.ts` can't complete an SSO / external
 * IdP redirect headlessly. Instead, run this once to open a real browser, log in
 * with SSO by hand, and snapshot the authenticated storage state that the
 * `chromium-authenticated` project reuses via `storageState`.
 *
 * Usage (from apps/web):
 *   PLAYWRIGHT_BASE_URL=<frontend-under-test> npx tsx e2e/capture-sso.ts
 *
 * A Chromium window opens on /organizations. Complete the SSO login there. Once
 * an authenticated page renders (the app leaves the login screen), press Enter
 * in the terminal — the state is written to e2e/.auth/user.json and the browser
 * closes. Existing specs then run without a fresh login, and the auth fixture's
 * E2E_TEST_EMAIL auto-skip must be satisfied too, so set a dummy value:
 *   E2E_TEST_EMAIL=sso E2E_COMPLIANCE_OPP_PATH=/organizations/.../opportunities/... \
 *     SKIP_WEB_SERVER=1 npx playwright test compliance-review
 * (SKIP_WEB_SERVER only when PLAYWRIGHT_BASE_URL points at an already-running app.)
 */
import { chromium } from '@playwright/test';
import path from 'path';
import readline from 'readline';

const authFile = path.join(__dirname, '.auth/user.json');
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

const waitForEnter = (prompt: string): Promise<void> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseURL.replace(/\/$/, '')}/organizations`);
  console.log(`\n🔐 A browser opened at ${baseURL}/organizations.`);
  console.log('   Complete the SSO login in that window.');

  await waitForEnter('\n👉 Once you see the authenticated app, press Enter here to save the session… ');

  // Guard against saving a still-logged-out state: Amplify persists Cognito
  // tokens in localStorage, so require at least one origin with entries.
  const state = await context.storageState({ path: authFile });
  const localStorageCount = state.origins.reduce((n, o) => n + o.localStorage.length, 0);
  if (localStorageCount === 0) {
    console.error(
      '\n❌ No localStorage found — the app is still logged out. Finish the SSO login, then run this again.',
    );
    await browser.close();
    process.exit(1);
  }
  console.log(`\n✅ Auth state saved to ${authFile} (${localStorageCount} localStorage entries)`);
  await browser.close();
};

void main();
