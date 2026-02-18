import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the SAM.gov Opportunities search page.
 */
export class OpportunitiesPage {
  readonly heading: Locator;
  readonly keywordInput: Locator;
  readonly searchButton: Locator;
  readonly filtersButton: Locator;
  readonly saveButton: Locator;

  constructor(private page: Page) {
    this.heading = page.locator('h1:has-text("Opportunities")');
    this.keywordInput = page.locator('input[placeholder*="Keywords"]');
    this.searchButton = page.locator('button:has-text("Search")');
    this.filtersButton = page.locator('button:has-text("Filters")');
    this.saveButton = page.locator('button:has-text("Save")');
  }

  async goto(): Promise<void> {
    await this.page.goto('/opportunities');
    await expect(this.heading).toBeVisible({ timeout: 10000 });
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: 10000 });
    await expect(this.keywordInput).toBeVisible();
    await expect(this.searchButton).toBeVisible();
  }

  async expectFiltersButtonVisible(): Promise<void> {
    await expect(this.filtersButton).toBeVisible();
  }

  async toggleFilters(): Promise<void> {
    await this.filtersButton.click();
  }

  async expectAdvancedFiltersVisible(): Promise<void> {
    const naicsLabel = this.page.locator('label:has-text("NAICS codes")');
    const agencyLabel = this.page.locator('label:has-text("Agency name")');

    const hasNaics = await naicsLabel.isVisible({ timeout: 5000 }).catch(() => false);
    const hasAgency = await agencyLabel.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasNaics || hasAgency).toBeTruthy();
  }

  async expectQuickDateFilters(): Promise<void> {
    const dateFilters = this.page.locator('button:has-text("7 days"), button:has-text("14 days"), button:has-text("30 days")');
    const filterCount = await dateFilters.count();
    expect(filterCount).toBeGreaterThan(0);
  }

  async expectSaveButtonVisible(): Promise<void> {
    await expect(this.saveButton).toBeVisible();
  }

  async openSaveSearchDialog(): Promise<void> {
    await this.saveButton.click();
    await expect(this.page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  }

  async search(keyword: string): Promise<void> {
    await this.keywordInput.fill(keyword);
    await this.searchButton.click();
  }

  async expectSearchResults(): Promise<void> {
    const resultsInfo = this.page.locator('div:has-text("Showing"), div:has-text("No opportunities")');
    await expect(resultsInfo.first()).toBeVisible({ timeout: 15000 });
  }

  async expectPagination(): Promise<boolean> {
    const paginationInfo = this.page.locator('div:has-text("Page ")');
    return paginationInfo.isVisible({ timeout: 15000 }).catch(() => false);
  }

  async expectResetButton(): Promise<boolean> {
    const resetButton = this.page.locator('button:has-text("Reset")');
    return resetButton.isVisible({ timeout: 5000 }).catch(() => false);
  }
}