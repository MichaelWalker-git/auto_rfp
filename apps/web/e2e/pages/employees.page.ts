import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the org-level Team (employees) pages:
 * list at /organizations/{orgId}/employees, plus the separate
 * create and edit pages.
 */
export class EmployeesPage {
  readonly table: Locator;
  readonly emptyState: Locator;
  readonly errorState: Locator;
  readonly skeleton: Locator;
  readonly addButton: Locator;
  readonly generateFromCvsButton: Locator;
  readonly searchInput: Locator;

  constructor(private readonly page: Page) {
    this.table = page.getByTestId('employee-table');
    this.emptyState = page.getByTestId('employee-empty-state');
    this.errorState = page.getByTestId('employee-error-state');
    this.skeleton = page.getByTestId('employee-table-skeleton');
    this.addButton = page.getByTestId('employees-add');
    this.generateFromCvsButton = page.getByTestId('employees-generate-from-cvs');
    this.searchInput = page.getByTestId('employees-search');
  }

  async goto(orgId: string): Promise<void> {
    await this.page.goto(`/organizations/${orgId}/employees`);
    await this.page.waitForLoadState('networkidle');
  }

  /** Waits for the page to settle into one of its real states (not the skeleton). */
  async expectLoaded(): Promise<void> {
    await expect(this.table.or(this.emptyState).or(this.errorState)).toBeVisible({
      timeout: 20000,
    });
    await expect(this.errorState).not.toBeVisible();
  }

  async hasEmployees(): Promise<boolean> {
    await this.expectLoaded();
    return this.table.isVisible();
  }

  rowByName(name: string): Locator {
    return this.table.locator('[data-testid^="employee-row-"]', { hasText: name });
  }

  /** Fills and submits the create form; resolves once back on the list page. */
  async createEmployee(input: {
    name: string;
    primaryRole: string;
    certifications?: string;
    location?: 'Onshore' | 'Offshore';
  }): Promise<void> {
    await this.addButton.or(this.page.getByTestId('employee-empty-add')).first().click();
    await this.page.waitForURL(/\/employees\/create/);

    await this.page.getByTestId('employee-form-name').fill(input.name);

    const primaryRoles = this.page.getByTestId('employee-form-primary-roles').locator('input');
    await primaryRoles.fill(input.primaryRole);
    await primaryRoles.press('Enter');

    if (input.certifications) {
      // Certifications is a tag input: type into the inner input and press Enter.
      const certs = this.page.getByTestId('employee-form-certifications').locator('input');
      await certs.fill(input.certifications);
      await certs.press('Enter');
    }
    if (input.location) {
      await this.page.getByLabel(input.location).check();
    }

    await this.page.getByTestId('employee-form-submit').click();
    await this.page.waitForURL(/\/employees\/?(\?.*)?$/, { timeout: 20000 });
  }

  async openEditByName(name: string): Promise<void> {
    const row = this.rowByName(name).first();
    await row.locator('[data-testid^="employee-edit-"]').click();
    await this.page.waitForURL(/\/employees\/[^/]+\/edit/, { timeout: 15000 });
  }

  /** Deletes the named employee through the confirm dialog. */
  async deleteByName(name: string): Promise<void> {
    const row = this.rowByName(name).first();
    await row.locator('[data-testid^="employee-delete-"]').click();
    const dialog = this.page.getByRole('alertdialog').or(this.page.getByRole('dialog'));
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /delete/i }).click();
    await expect(this.rowByName(name)).toHaveCount(0, { timeout: 20000 });
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
  }
}
