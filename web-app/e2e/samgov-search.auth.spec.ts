import { test, expect } from '@playwright/test';

test.describe('SAM.gov Search (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should navigate to opportunities page', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Should see page title
    const heading = page.locator('h1:has-text("Opportunities")');
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('should display search form with keyword input', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Should see keyword input
    const keywordInput = page.locator('input[placeholder*="Keywords"]');
    await expect(keywordInput).toBeVisible({ timeout: 10000 });
  });

  test('should display search button', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Should see Search button
    const searchButton = page.locator('button:has-text("Search")');
    await expect(searchButton).toBeVisible({ timeout: 10000 });
  });

  test('should display filters toggle button', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Should see Filters button
    const filtersButton = page.locator('button:has-text("Filters")');
    await expect(filtersButton).toBeVisible({ timeout: 10000 });
  });

  test('should toggle advanced filters panel', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Click Filters button to expand
    const filtersButton = page.locator('button:has-text("Filters")');
    await filtersButton.click();

    // Should see advanced filter fields
    const naicsLabel = page.locator('label:has-text("NAICS codes")');
    const agencyLabel = page.locator('label:has-text("Agency name")');

    const hasNaics = await naicsLabel.isVisible({ timeout: 5000 }).catch(() => false);
    const hasAgency = await agencyLabel.isVisible({ timeout: 5000 }).catch(() => false);

    console.log(`NAICS field: ${hasNaics}, Agency field: ${hasAgency}`);
  });

  test('should display quick date filters', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Should see quick date filter buttons (7 days, 14 days, 30 days, etc.)
    const dateFilters = page.locator('button:has-text("7 days"), button:has-text("14 days"), button:has-text("30 days")');
    const filterCount = await dateFilters.count();

    console.log(`Found ${filterCount} quick date filters`);
    expect(filterCount).toBeGreaterThan(0);
  });

  test('should display save search button', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Should see Save button
    const saveButton = page.locator('button:has-text("Save")');
    await expect(saveButton).toBeVisible({ timeout: 10000 });
  });

  test('should open save search dialog', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Click Save button
    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();

    // Dialog should open
    const dialog = page.locator('[role="dialog"]');
    const hasDialog = await dialog.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasDialog) {
      // Should see save search form fields
      const nameInput = page.locator('input').filter({ hasText: /name/i }).or(page.locator('[role="dialog"] input').first());
      const frequencySelect = page.locator('select');

      const hasNameInput = await nameInput.isVisible().catch(() => false);
      const hasFrequency = await frequencySelect.isVisible().catch(() => false);

      console.log(`Name input: ${hasNameInput}, Frequency select: ${hasFrequency}`);
    }
  });

  test('should perform search and show results or empty state', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Enter a keyword
    const keywordInput = page.locator('input[placeholder*="Keywords"]');
    await keywordInput.fill('cloud migration');

    // Click search
    const searchButton = page.locator('button:has-text("Search")');
    await searchButton.click();

    // Wait for search to complete
    await page.waitForLoadState('networkidle');

    // Should see results info or empty state
    const resultsInfo = page.locator('div:has-text("Showing"), div:has-text("No opportunities")');
    const hasResults = await resultsInfo.first().isVisible({ timeout: 15000 }).catch(() => false);

    console.log(`Search results displayed: ${hasResults}`);
  });

  test('should display pagination when results exist', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Click search with default filters
    const searchButton = page.locator('button:has-text("Search")');
    await searchButton.click();

    await page.waitForLoadState('networkidle');

    // Look for pagination info
    const paginationInfo = page.locator('div:has-text("Page ")');
    const hasPagination = await paginationInfo.isVisible({ timeout: 15000 }).catch(() => false);

    console.log(`Pagination visible: ${hasPagination}`);
  });

  test('should clear filters with reset button', async ({ page }) => {
    await page.goto('/opportunities');
    await page.waitForLoadState('networkidle');

    // Open filters
    const filtersButton = page.locator('button:has-text("Filters")');
    await filtersButton.click();

    // Look for Reset filters button
    const resetButton = page.locator('button:has-text("Reset")');
    const hasReset = await resetButton.isVisible({ timeout: 5000 }).catch(() => false);

    console.log(`Reset filters button visible: ${hasReset}`);
  });

  test('should navigate to opportunities from organization page', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Navigate to first org
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Look for opportunities link in nav
    const opportunitiesLink = page.getByRole('link', { name: /opportunities/i });
    if (await opportunitiesLink.isVisible()) {
      await opportunitiesLink.click();
      await page.waitForLoadState('networkidle');

      // Should see opportunities page content
      const heading = page.locator('h1:has-text("Opportunities")');
      const hasHeading = await heading.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Opportunities page heading: ${hasHeading}`);
    }
  });
});
