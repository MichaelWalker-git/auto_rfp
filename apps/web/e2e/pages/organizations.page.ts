import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Organizations pages.
 */
export class OrganizationsPage {
  readonly heading: Locator;
  readonly createButton: Locator;
  readonly orgLinks: Locator;

  constructor(private page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
    this.createButton = page.getByRole('button', { name: /create|new|add/i });
    this.orgLinks = page.locator('a[href*="/organizations/"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/organizations');
    await this.heading.waitFor({ state: 'visible', timeout: 15000 });
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async expectCreateButtonVisible(): Promise<void> {
    await expect(this.createButton).toBeVisible();
  }

  async openCreateDialog(): Promise<void> {
    await this.createButton.click();
    await expect(this.page.locator('input[id="name"], input[name="name"]').first()).toBeVisible({ timeout: 5000 });
  }

  async createOrganization(name: string, description?: string): Promise<void> {
    await this.openCreateDialog();

    const nameInput = this.page.locator('input[id="name"], input[name="name"]').first();
    await nameInput.fill(name);

    if (description) {
      const descInput = this.page.locator('textarea[id="description"], textarea[name="description"]').first();
      if (await descInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await descInput.fill(description);
      }
    }

    const submitButton = this.page.locator('button[type="submit"], button:has-text("Create")').first();
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
  }

  async expectOrganizationCreated(name: string): Promise<void> {
    const orgInList = this.page.locator(`text="${name}"`);
    const successToast = this.page.locator('[role="alert"]:has-text("success"), [role="alert"]:has-text("created")');
    const redirectedToOrg = this.page.url().match(/\/organizations\/[a-f0-9-]+/);

    const hasOrgInList = await orgInList.isVisible({ timeout: 5000 }).catch(() => false);
    const hasSuccessToast = await successToast.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasOrgInList || hasSuccessToast || !!redirectedToOrg).toBeTruthy();
  }

  async submitEmptyForm(): Promise<void> {
    const submitButton = this.page.locator('button[type="submit"], button:has-text("Create")').first();
    await submitButton.click();
  }

  async expectValidationError(): Promise<void> {
    const validationError = this.page.locator('[class*="error"], [role="alert"]:has-text("required"), :text("required")');
    const submitButton = this.page.locator('button[type="submit"], button:has-text("Create")').first();
    const buttonDisabled = await submitButton.isDisabled();
    const hasValidationError = await validationError.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasValidationError || buttonDisabled).toBeTruthy();
  }

  async getFirstOrgName(): Promise<string | null> {
    const firstOrgName = await this.page.locator('[class*="Card"] h3, [class*="card"] h3').first().textContent();
    return firstOrgName?.trim() ?? null;
  }

  async navigateToFirstOrg(): Promise<boolean> {
    const orgLink = this.orgLinks.first();
    if (!(await orgLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await orgLink.click();
    await this.page.waitForURL(/\/organizations\/[a-zA-Z0-9-]+/);
    return true;
  }

  async hasOrganizations(): Promise<boolean> {
    return this.orgLinks.first().isVisible({ timeout: 5000 }).catch(() => false);
  }
}