import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for Knowledge Base pages.
 */
export class KnowledgeBasePage {
  readonly heading: Locator;
  readonly newKbButton: Locator;
  readonly kbCards: Locator;
  readonly uploadButton: Locator;

  constructor(private page: Page) {
    this.heading = page.locator('h1:has-text("Knowledge Base")');
    this.newKbButton = page.locator('button:has-text("New Knowledge Base")');
    this.kbCards = page.locator('a[href*="/knowledge-base/"]');
    this.uploadButton = page.locator('button:has-text("Upload Documents")');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: 10000 });
  }

  async expectNewKbButtonVisible(): Promise<void> {
    await expect(this.newKbButton).toBeVisible({ timeout: 5000 });
  }

  async expectListOrEmptyState(): Promise<void> {
    const hasCards = await this.kbCards.first().isVisible({ timeout: 5000 }).catch(() => false);
    const emptyState = this.page.locator('div:has-text("No knowledge bases")');
    const hasEmpty = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasCards || hasEmpty).toBeTruthy();
  }

  async openCreateDialog(): Promise<void> {
    await this.newKbButton.click();
    await expect(this.page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  }

  async expectCreateDialogHasFields(): Promise<void> {
    await expect(this.page.locator('input#name')).toBeVisible();
    await expect(this.page.locator('textarea#description')).toBeVisible();
  }

  async navigateToFirstKb(): Promise<boolean> {
    const kbCard = this.kbCards.first();
    if (!(await kbCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await kbCard.click();
    await this.page.waitForURL(/\/knowledge-base\/[a-zA-Z0-9-]+/);
    return true;
  }

  async expectUploadButtonVisible(): Promise<void> {
    await expect(this.uploadButton).toBeVisible({ timeout: 5000 });
  }

  async openUploadDialog(): Promise<void> {
    await this.uploadButton.click();
    await expect(this.page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  }

  async expectUploadDialogHasFileInput(): Promise<void> {
    const fileInput = this.page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 5000 });
  }

  async expectDocumentsSection(): Promise<boolean> {
    const documentsHeading = this.page.locator('h1, h2, h3').filter({ hasText: 'Documents' });
    return documentsHeading.isVisible({ timeout: 5000 }).catch(() => false);
  }

  async getStatusBadgeCount(): Promise<number> {
    const statusBadges = this.page.locator('span:has-text("Indexed"), span:has-text("Chunked"), span:has-text("Failed")');
    return statusBadges.count();
  }

  async expectDocumentStats(): Promise<void> {
    const documentsLabel = this.page.locator('div:has-text("Documents")');
    await expect(documentsLabel.first()).toBeVisible({ timeout: 5000 });
  }
}