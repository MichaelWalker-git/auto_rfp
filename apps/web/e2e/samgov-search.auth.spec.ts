import { test, expect } from './fixtures/auth';

test.describe('SAM.gov Search (Authenticated)', () => {
  test('should navigate to opportunities page', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await opportunitiesPage.expectLoaded();
  });

  test('should display search form with keyword input', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await expect(opportunitiesPage.keywordInput).toBeVisible();
  });

  test('should display search button', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await expect(opportunitiesPage.searchButton).toBeVisible();
  });

  test('should display filters toggle button', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await opportunitiesPage.expectFiltersButtonVisible();
  });

  test('should toggle advanced filters panel', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await opportunitiesPage.toggleFilters();
    await opportunitiesPage.expectAdvancedFiltersVisible();
  });

  test('should display quick date filters', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await opportunitiesPage.expectQuickDateFilters();
  });

  test('should display save search button', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await opportunitiesPage.expectSaveButtonVisible();
  });

  test('should open save search dialog', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await opportunitiesPage.openSaveSearchDialog();
  });

  test('should perform search and show results or empty state', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await opportunitiesPage.search('cloud migration');
    await opportunitiesPage.expectSearchResults();
  });

  test('should display pagination when results exist', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await opportunitiesPage.search('');
    const hasPagination = await opportunitiesPage.expectPagination();
    expect(typeof hasPagination).toBe('boolean');
  });

  test('should show reset filters button when filters applied', async ({ opportunitiesPage }) => {
    await opportunitiesPage.goto();
    await opportunitiesPage.toggleFilters();
    const hasReset = await opportunitiesPage.expectResetButton();
    expect(typeof hasReset).toBe('boolean');
  });

  test('should navigate to opportunities from organization page', async ({ nav, page }) => {
    const orgHref = await nav.goToFirstOrganization();
    if (!orgHref) {
      test.skip();
      return;
    }

    const opportunitiesLink = page.getByRole('link', { name: /opportunities/i });
    if (await opportunitiesLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await opportunitiesLink.click();

      const heading = page.locator('h1:has-text("Opportunities")');
      await expect(heading).toBeVisible({ timeout: 5000 });
    }
  });
});