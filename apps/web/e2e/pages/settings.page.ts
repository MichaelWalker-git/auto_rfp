import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for Organization Settings page.
 */
export class SettingsPage {
  readonly heading: Locator;
  readonly generalSettings: Locator;
  readonly nameInput: Locator;
  readonly saveButton: Locator;
  readonly dangerZone: Locator;
  readonly deleteButton: Locator;
  readonly confirmInput: Locator;

  constructor(private page: Page) {
    this.heading = page.locator('h1:has-text("Organization Settings")');
    this.generalSettings = page.locator('h2:has-text("General Settings"), h3:has-text("General Settings")');
    this.nameInput = page.locator('input#name');
    this.saveButton = page.locator('button:has-text("Save Changes")');
    this.dangerZone = page.locator('h2:has-text("Danger Zone"), h3:has-text("Danger Zone")');
    this.deleteButton = page.locator('button:has-text("Delete Organization")');
    this.confirmInput = page.locator('input#confirm');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: 10000 });
  }

  async expectGeneralSettingsVisible(): Promise<void> {
    await expect(this.generalSettings).toBeVisible({ timeout: 5000 });
  }

  async expectNameInputVisible(): Promise<void> {
    await expect(this.nameInput).toBeVisible({ timeout: 5000 });
  }

  async expectSaveButtonVisible(): Promise<void> {
    await expect(this.saveButton).toBeVisible({ timeout: 5000 });
  }

  async expectDangerZoneVisible(): Promise<void> {
    await expect(this.dangerZone).toBeVisible({ timeout: 5000 });
  }

  async expectDeleteButtonVisible(): Promise<void> {
    await expect(this.deleteButton).toBeVisible({ timeout: 5000 });
  }

  async expectConfirmInputVisible(): Promise<void> {
    await expect(this.confirmInput).toBeVisible({ timeout: 5000 });
  }

  async expectDeleteWarningVisible(): Promise<void> {
    const warning = this.page.locator('div:has-text("permanently remove all projects")');
    await expect(warning).toBeVisible({ timeout: 5000 });
  }

  async expectSavedSearchesSection(): Promise<boolean> {
    const savedSearches = this.page.locator('h2:has-text("Saved Searches"), h3:has-text("Saved Searches"), div:has-text("Saved Searches")');
    return savedSearches.first().isVisible({ timeout: 5000 }).catch(() => false);
  }

  async expectPromptsSection(): Promise<boolean> {
    const prompts = this.page.locator('h2:has-text("Prompts"), h3:has-text("Prompts"), div:has-text("Custom Prompts")');
    return prompts.first().isVisible({ timeout: 5000 }).catch(() => false);
  }

  // Custom Prompts methods
  async getNewPromptButton(): Promise<Locator> {
    return this.page.locator('button:has-text("New prompt")');
  }

  async getRefreshButton(): Promise<Locator> {
    return this.page.locator('button:has-text("Refresh")');
  }

  async getEditButtons(): Promise<Locator> {
    return this.page.locator('button:has-text("Edit")');
  }

  async getSaveButtons(): Promise<Locator> {
    return this.page.locator('button:has-text("Save")');
  }

  async clickFirstEditButton(): Promise<boolean> {
    const editButton = this.page.locator('button:has-text("Edit")').first();
    if (!(await editButton.isVisible({ timeout: 3000 }).catch(() => false))) {
      return false;
    }
    await editButton.click();
    return true;
  }

  async expectExpandedEditor(): Promise<void> {
    const textarea = this.page.locator('textarea[placeholder*="prompt"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });
  }

  async expectCollapseButtonVisible(): Promise<void> {
    await expect(this.page.locator('button:has-text("Collapse")')).toBeVisible({ timeout: 5000 });
  }

  async expectRuntimeParamsSection(): Promise<void> {
    const paramsSection = this.page.locator('div:has-text("Runtime params")');
    await expect(paramsSection).toBeVisible({ timeout: 5000 });
  }

  async modifyPromptText(text: string): Promise<void> {
    const textarea = this.page.locator('textarea[placeholder*="prompt"]').first();
    await textarea.fill(text);
  }

  async expectUnsavedBadge(): Promise<void> {
    await expect(this.page.locator('span:has-text("Unsaved")')).toBeVisible({ timeout: 5000 });
  }

  // Linear API Key methods
  async expectLinearSectionVisible(): Promise<void> {
    await expect(this.page.locator('text=Linear API Key Management')).toBeVisible({ timeout: 10000 });
  }

  async openLinearConfigDialog(): Promise<void> {
    const configureButton = this.page.locator('button:has-text("Configure")').nth(1);
    await configureButton.click();
    await expect(this.page.locator('text=Configure Linear API Key')).toBeVisible({ timeout: 5000 });
  }

  async expectLinearDialogFields(): Promise<void> {
    await expect(this.page.locator('input[placeholder="Enter your Linear API key"]')).toBeVisible();
    await expect(this.page.locator('text=How to get a Linear API Key')).toBeVisible();
  }

  async closeLinearDialog(): Promise<void> {
    await this.page.locator('button:has-text("Cancel")').click();
  }
}