import { type Locator, type Page, expect } from '@playwright/test';

/**
 * Page object for the Solution Plan version-history surfaces: the header
 * version dropdown (W1), the history side panel (W2), the read-only version
 * view (W3), and the restore/delete confirmation dialogs (W4/W6).
 *
 * The control mounts in two places with identical testids — the opportunity
 * page's Solution Plan panel and the plan editor's toolbar — so this object
 * works on both. All selectors are the feature's own `data-testid`s.
 */
export class SolutionPlanVersionsPage {
  constructor(private readonly page: Page) {}

  // ── Header dropdown (W1) ──

  get dropdownTrigger(): Locator {
    return this.page.getByTestId('version-dropdown-trigger');
  }

  dropdownItem(versionId: string): Locator {
    return this.page.getByTestId(`version-dropdown-item-${versionId}`);
  }

  get seeAllItem(): Locator {
    return this.page.getByTestId('version-dropdown-see-all');
  }

  async openDropdown(): Promise<void> {
    await this.dropdownTrigger.click();
    await expect(this.seeAllItem).toBeVisible();
  }

  async openHistoryPanel(): Promise<void> {
    await this.openDropdown();
    await this.seeAllItem.click();
    await expect(this.historyPanel).toBeVisible();
  }

  /** Close the history sheet via its X button and wait for the overlay to go. */
  async closeHistoryPanel(): Promise<void> {
    await this.historyPanel.getByRole('button', { name: /close/i }).click();
    await expect(this.historyPanel).not.toBeVisible();
  }

  // ── History panel (W2) ──

  get historyPanel(): Locator {
    return this.page.getByTestId('version-history-panel');
  }

  get emptyState(): Locator {
    return this.page.getByTestId('version-list-empty');
  }

  versionRow(versionId: string): Locator {
    return this.page.getByTestId(`version-row-${versionId}`);
  }

  rowLabel(versionId: string): Locator {
    return this.page.getByTestId(`version-row-label-${versionId}`);
  }

  async openRowActions(versionId: string): Promise<void> {
    await this.page.getByTestId(`version-row-actions-${versionId}`).click();
  }

  rowAction(action: 'view' | 'restore' | 'rename' | 'delete', versionId: string): Locator {
    return this.page.getByTestId(`version-row-${action}-${versionId}`);
  }

  // ── Read-only view modal (W3) ──

  get viewBanner(): Locator {
    return this.page.getByTestId('version-view-banner');
  }

  get viewClose(): Locator {
    return this.page.getByTestId('version-view-close');
  }

  get viewRestore(): Locator {
    return this.page.getByTestId('version-view-restore');
  }

  get viewDelete(): Locator {
    return this.page.getByTestId('version-view-delete');
  }

  get viewRename(): Locator {
    return this.page.getByTestId('version-view-rename');
  }

  // ── Label inline editor (W5) ──

  get labelInput(): Locator {
    return this.page.getByTestId('version-label-input');
  }

  /** Type a label and save it with Enter; waits for the PATCH to succeed. */
  async saveLabel(value: string): Promise<void> {
    await expect(this.labelInput).toBeVisible();
    await this.labelInput.fill(value);
    const [labelResponse] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          res.url().includes('/solution-plan/version/label') &&
          res.request().method() === 'PATCH',
        { timeout: 30_000 },
      ),
      this.labelInput.press('Enter'),
    ]);
    expect(labelResponse.status()).toBe(200);
  }

  // ── Confirmation dialogs (W4/W6) ──

  get restoreConfirmDialog(): Locator {
    return this.page.getByTestId('restore-confirm-dialog');
  }

  get deleteConfirmDialog(): Locator {
    return this.page.getByTestId('delete-confirm-dialog');
  }

  /** Confirm the open restore dialog and wait for the POST to succeed. */
  async confirmRestore(): Promise<void> {
    await expect(this.restoreConfirmDialog).toBeVisible();
    const [restoreResponse] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          res.url().includes('/solution-plan/version/restore') &&
          res.request().method() === 'POST',
        { timeout: 60_000 },
      ),
      this.page.getByTestId('restore-confirm').click(),
    ]);
    expect(restoreResponse.status()).toBe(200);
    await expect(this.restoreConfirmDialog).not.toBeVisible({ timeout: 15_000 });
  }

  /** Confirm the open delete dialog and wait for the DELETE to succeed. */
  async confirmDelete(): Promise<void> {
    await expect(this.deleteConfirmDialog).toBeVisible();
    const [deleteResponse] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          res.url().includes('/solution-plan/version') &&
          res.request().method() === 'DELETE',
        { timeout: 30_000 },
      ),
      this.page.getByTestId('delete-confirm').click(),
    ]);
    expect(deleteResponse.status()).toBe(200);
    await expect(this.deleteConfirmDialog).not.toBeVisible({ timeout: 15_000 });
  }

  // ── Version list API observation ──

  /**
   * Run `action` and capture the next GET /solution-plan/versions payload it
   * triggers — the honest way to learn versionIds/currentVersionId on a real
   * backend without duplicating client fetch logic.
   */
  async captureVersionList(action: () => Promise<void>): Promise<{
    versions: Array<{
      versionId: string;
      createdAt: string;
      origin: string;
      label?: string;
      createdByName: string;
    }>;
    currentVersionId: string | null;
  }> {
    const [listResponse] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          res.url().includes('/solution-plan/versions') &&
          res.request().method() === 'GET' &&
          res.status() === 200,
        { timeout: 60_000 },
      ),
      action(),
    ]);
    return (await listResponse.json()) as {
      versions: Array<{
        versionId: string;
        createdAt: string;
        origin: string;
        label?: string;
        createdByName: string;
      }>;
      currentVersionId: string | null;
    };
  }
}
