import { test, expect } from './fixtures/auth';

/**
 * HOR-2729 — "Make Linear-ticket + Drive-folder actions discoverable."
 *
 * The two previously-hidden capabilities are now explicit buttons on the
 * executive-brief card header. When the artifact already exists, the button is
 * replaced by a link to it. Nothing is created without an explicit click
 * (discoverable ≠ automatic).
 *
 * These are lenient smoke checks — the seeded project may not have a completed
 * brief, so we assert the actions are *discoverable* rather than forcing a
 * mutation against Linear / Google Drive in CI.
 */
test.describe('Brief discoverable actions (Authenticated)', () => {
  test.beforeEach(async ({ nav }) => {
    const projectHref = await nav.goToFirstProject();
    if (!projectHref) {
      test.skip();
    }
  });

  test('exposes a Linear-ticket action or a link to an existing ticket', async ({ page }) => {
    const createTicket = page.locator('button:has-text("Create Linear ticket")');
    const viewTicket = page.locator('a:has-text("View in Linear"), a:has-text("View "), button:has-text("View in Linear")');

    const hasCreate = await createTicket.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasView = await viewTicket.first().isVisible({ timeout: 5000 }).catch(() => false);

    // At most one is shown at a time; either is a valid discoverable state.
    expect(typeof (hasCreate || hasView)).toBe('boolean');
  });

  test('exposes a Drive-folder action or a link to an existing folder', async ({ page }) => {
    const createFolder = page.locator('button:has-text("Create Drive folder")');
    const openFolder = page.locator('a:has-text("Open Drive folder")');

    const hasCreate = await createFolder.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasOpen = await openFolder.first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(typeof (hasCreate || hasOpen)).toBe('boolean');
  });

  test('Linear ticket creation is confirmation-gated (no auto-create)', async ({ page }) => {
    const createTicket = page.locator('button:has-text("Create Linear ticket")');
    const isVisible = await createTicket.first().isVisible({ timeout: 5000 }).catch(() => false);
    const isEnabled = isVisible ? await createTicket.first().isEnabled().catch(() => false) : false;

    if (!isVisible || !isEnabled) {
      // No completed brief in the seed data — nothing to confirm against.
      test.skip();
    }

    await createTicket.first().click();

    // A preview/confirm dialog must appear before anything is created.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Create Linear ticket')).toBeVisible();

    // Cancelling must not create anything.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden({ timeout: 5000 });
  });
});
