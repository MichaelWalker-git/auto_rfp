import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { DocumentPromptsPage } from './pages/document-prompts.page';

/**
 * DP-10 · E2E sanity for Document Generation prompt overrides.
 *
 * Flow: prompts page → Document Generation tab → edit COST_PROPOSAL guidance →
 * save → Customized badge → reset → Default badge.
 */

const TYPE_LABEL = 'Cost Proposal';
const DOCUMENT_TYPE = 'COST_PROPOSAL';
const OVERRIDE_MARKER = '[E2E override — safe to delete]';

/** The 16 overridable built-in types × 2 scopes (guidance + task) = 32 rows. */
const EXPECTED_FRAGMENT_ROWS = 32;

/** Feature types that must no longer appear on the AI Features tab. */
const DEAD_FEATURE_TYPES = ['RFP_DOCUMENT', 'PROPOSAL', 'TECHNICAL_PROPOSAL'];

test.describe('Document Generation Prompts (Authenticated)', () => {
  let orgHref: string | null = null;

  const gotoGuidanceRow = async (prompts: DocumentPromptsPage): Promise<Locator> => {
    await prompts.gotoForOrg(orgHref!, 'documents');
    await prompts.waitForDocumentsLoaded();
    const row = prompts.fragmentRow('SYSTEM', DOCUMENT_TYPE);
    await row.scrollIntoViewIfNeeded();
    return row;
  };

  test.beforeEach(async ({ nav }) => {
    orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
    }
  });

  // Safety net: if a test failed mid-flow, remove any leftover COST_PROPOSAL
  // guidance override so runs stay independent of each other.
  test.afterEach(async ({ documentPromptsPage }) => {
    if (!orgHref) return;
    const row = await gotoGuidanceRow(documentPromptsPage).catch(() => null);
    if (row) {
      await documentPromptsPage.resetIfCustomized(row, 'SYSTEM').catch(() => undefined);
    }
  });

  test('should show AI Features and Document Generation tabs', async ({ documentPromptsPage }) => {
    await documentPromptsPage.gotoForOrg(orgHref!, 'features');

    await expect(documentPromptsPage.featuresTab).toBeVisible();
    await expect(documentPromptsPage.documentsTab).toBeVisible();
  });

  test('should not list dead feature types on the AI Features tab', async ({
    page,
    documentPromptsPage,
  }) => {
    await documentPromptsPage.gotoForOrg(orgHref!, 'features');
    await documentPromptsPage.waitForFeaturesLoaded();

    for (const deadType of DEAD_FEATURE_TYPES) {
      await expect(page.getByText(deadType, { exact: true })).toHaveCount(0);
    }
  });

  test('should list all 16 document types with Guidance and Task instructions rows', async ({
    page,
    documentPromptsPage,
  }) => {
    await documentPromptsPage.gotoForOrg(orgHref!, 'documents');
    await documentPromptsPage.waitForDocumentsLoaded();

    await expect(page.getByText(TYPE_LABEL, { exact: true })).toBeVisible();
    await expect(documentPromptsPage.fragmentRow('SYSTEM', DOCUMENT_TYPE)).toBeVisible();
    await expect(documentPromptsPage.fragmentRow('USER', DOCUMENT_TYPE)).toBeVisible();
    await expect(documentPromptsPage.fragmentRows).toHaveCount(EXPECTED_FRAGMENT_ROWS);
  });

  test('should pre-fill default guidance text with a Default badge', async ({
    documentPromptsPage,
  }) => {
    const row = await gotoGuidanceRow(documentPromptsPage);

    const outcome = await documentPromptsPage.resetIfCustomized(row, 'SYSTEM');
    if (outcome === 'forbidden') {
      test.skip(true, 'Leftover override and test user lacks prompt:delete — cannot reach Default state');
      return;
    }

    await expect(documentPromptsPage.defaultBadge(row)).toBeVisible();

    await documentPromptsPage.expandRow(row);
    const textarea = documentPromptsPage.fragmentTextarea(DOCUMENT_TYPE, 'Guidance');
    await expect(textarea).toBeVisible();
    await expect(textarea).not.toHaveValue('');
  });

  test('should save a guidance override then reset it back to default', async ({
    documentPromptsPage,
  }) => {
    const row = await gotoGuidanceRow(documentPromptsPage);

    const outcome = await documentPromptsPage.resetIfCustomized(row, 'SYSTEM');
    if (outcome === 'forbidden') {
      test.skip(true, 'Leftover override and test user lacks prompt:delete — cannot reach Default state');
      return;
    }

    // Edit the guidance fragment
    await documentPromptsPage.expandRow(row);
    const textarea = documentPromptsPage.fragmentTextarea(DOCUMENT_TYPE, 'Guidance');
    const defaultText = await textarea.inputValue();
    await textarea.fill(`${defaultText}\n\n${OVERRIDE_MARKER}`);
    await expect(documentPromptsPage.unsavedBadge(row)).toBeVisible();

    // Skip on non-admin accounts: PermissionButton renders Save disabled without prompt:create
    if (!(await documentPromptsPage.saveButton(row).isEnabled())) {
      test.skip(true, 'Test user lacks prompt:create — cannot exercise save/reset flow');
      return;
    }

    // Save → Customized badge
    await documentPromptsPage.saveRow(row, 'SYSTEM');
    await expect(documentPromptsPage.customizedBadge(row)).toBeVisible({ timeout: 10000 });
    await expect(documentPromptsPage.unsavedBadge(row)).toHaveCount(0);

    // Reset → confirm dialog → Default badge again
    await documentPromptsPage.resetRow(row, 'SYSTEM');
    await expect(documentPromptsPage.defaultBadge(row)).toBeVisible({ timeout: 10000 });
    await expect(documentPromptsPage.customizedBadge(row)).toHaveCount(0);

    // Default text is restored (marker gone)
    const restored = await documentPromptsPage
      .fragmentTextarea(DOCUMENT_TYPE, 'Guidance')
      .inputValue();
    expect(restored).not.toContain(OVERRIDE_MARKER);
  });

  test('should keep tab selection in the URL', async ({ page, documentPromptsPage }) => {
    await documentPromptsPage.gotoForOrg(orgHref!, 'features');

    await documentPromptsPage.documentsTab.click();
    await expect(page).toHaveURL(/tab=documents/);
    await documentPromptsPage.waitForDocumentsLoaded();

    await documentPromptsPage.featuresTab.click();
    await expect(page).not.toHaveURL(/tab=documents/);
  });
});
