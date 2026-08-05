import { type Page, type Locator, expect } from '@playwright/test';

export type DocumentPromptScope = 'SYSTEM' | 'USER';

/** Outcome of a best-effort reset attempt. */
export type ResetOutcome = 'reset' | 'already-default' | 'forbidden';

/**
 * Page Object Model for the Prompts settings page
 * (/organizations/{orgId}/settings/prompts) — AI Features and
 * Document Generation tabs.
 */
export class DocumentPromptsPage {
  constructor(private page: Page) {}

  /** Navigate to the prompts page for an org. Tab state is carried in the URL via nuqs. */
  async gotoForOrg(orgHref: string, tab: 'features' | 'documents' = 'documents'): Promise<void> {
    const query = tab === 'documents' ? '?tab=documents' : '';
    await this.page.goto(`${orgHref}/settings/prompts${query}`);
    await expect(this.page.getByRole('heading', { name: 'Prompts', exact: true })).toBeVisible({
      timeout: 15000,
    });
  }

  get featuresTab(): Locator {
    return this.page.getByRole('tab', { name: 'AI Features' });
  }

  get documentsTab(): Locator {
    return this.page.getByRole('tab', { name: 'Document Generation' });
  }

  /** Static explainer at the top of the Document Generation tab — rendered once loading finishes. */
  get documentsExplainer(): Locator {
    return this.page.getByText(/managed by the system and cannot be overridden/i);
  }

  /** Wait until the Document Generation tab content has finished loading (skeletons gone). */
  async waitForDocumentsLoaded(): Promise<void> {
    await expect(this.documentsExplainer).toBeVisible({ timeout: 15000 });
  }

  /** Wait until the AI Features tab content has finished loading (rows or empty state). */
  async waitForFeaturesLoaded(): Promise<void> {
    const emptyState = this.page.getByText('No prompts yet');
    const firstEditButton = this.page.getByRole('button', { name: 'Edit', exact: true }).first();
    await expect(emptyState.or(firstEditButton)).toBeVisible({ timeout: 15000 });
  }

  /** All fragment rows rendered on the page (both tabs share the row testid prefix). */
  get fragmentRows(): Locator {
    return this.page.getByTestId(/^document-prompt-row-/);
  }

  /** One fragment row (guidance = SYSTEM, task = USER) for a document type. */
  fragmentRow(scope: DocumentPromptScope, documentType: string): Locator {
    return this.page.getByTestId(`document-prompt-row-${scope}-${documentType}`);
  }

  /** The fragment textarea, addressable by its accessible label. */
  fragmentTextarea(documentType: string, scopeLabel: 'Guidance' | 'Task instructions'): Locator {
    return this.page.getByLabel(`${scopeLabel} for ${documentType}`, { exact: true });
  }

  defaultBadge(row: Locator): Locator {
    return row.getByText('Default', { exact: true });
  }

  customizedBadge(row: Locator): Locator {
    return row.getByText('Customized', { exact: true });
  }

  unsavedBadge(row: Locator): Locator {
    return row.getByText('Unsaved', { exact: true });
  }

  saveButton(row: Locator): Locator {
    return row.getByRole('button', { name: 'Save', exact: true });
  }

  resetButton(row: Locator): Locator {
    return row.getByRole('button', { name: 'Reset to default' });
  }

  async expandRow(row: Locator): Promise<void> {
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
  }

  /** Click Save on a row and wait for the save-prompt API call to succeed. */
  async saveRow(row: Locator, scope: DocumentPromptScope): Promise<void> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.url().includes(`/prompt/save-prompt/${scope}`) && r.request().method() === 'POST',
      ),
      this.saveButton(row).click(),
    ]);
    expect(response.status()).toBe(200);
  }

  /** Click "Reset to default", confirm the dialog, and wait for the DELETE call to succeed. */
  async resetRow(row: Locator, scope: DocumentPromptScope): Promise<void> {
    await this.resetButton(row).click();

    const dialog = this.page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.url().includes(`/prompt/delete-prompt/${scope}`) && r.request().method() === 'DELETE',
      ),
      dialog.getByRole('button', { name: 'Reset', exact: true }).click(),
    ]);
    expect(response.status()).toBe(200);
  }

  /**
   * Best-effort reset of a leftover override so a test starts from the Default
   * state. The reset PermissionButton renders visible-but-disabled without
   * prompt:delete, so a disabled button reports 'forbidden' rather than timing out.
   */
  async resetIfCustomized(row: Locator, scope: DocumentPromptScope): Promise<ResetOutcome> {
    const reset = this.resetButton(row);
    if ((await reset.count()) === 0) return 'already-default';
    if (!(await reset.isEnabled())) return 'forbidden';

    await this.resetRow(row, scope);
    await expect(this.defaultBadge(row)).toBeVisible({ timeout: 10000 });
    return 'reset';
  }
}
