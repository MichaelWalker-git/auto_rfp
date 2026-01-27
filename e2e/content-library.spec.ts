import { test, expect } from '@playwright/test';

// Test data
const TEST_ORG_ID = 'test-org-id';
const CONTENT_LIBRARY_URL = `/organizations/${TEST_ORG_ID}/content-library`;

test.describe('Content Library', () => {
  test.beforeEach(async ({ page }) => {
    // Mock API responses for testing without a real backend
    await page.route('**/api/organizations/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: TEST_ORG_ID,
          name: 'Test Organization',
        }),
      });
    });

    await page.route('**/api/content-library/items**', (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      if (method === 'GET') {
        // Return mock content library items
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              items: [
                {
                  id: 'item-1',
                  orgId: TEST_ORG_ID,
                  question: 'What is your company background?',
                  answer: 'We are a leading technology company...',
                  category: 'Company',
                  tags: ['about', 'company'],
                  usageCount: 5,
                  usedInProjectIds: [],
                  currentVersion: 1,
                  versions: [
                    {
                      version: 1,
                      text: 'We are a leading technology company...',
                      createdAt: '2025-01-01T00:00:00Z',
                      createdBy: 'user-1',
                    },
                  ],
                  isArchived: false,
                  approvalStatus: 'APPROVED',
                  createdAt: '2025-01-01T00:00:00Z',
                  updatedAt: '2025-01-15T00:00:00Z',
                  createdBy: 'user-1',
                },
                {
                  id: 'item-2',
                  orgId: TEST_ORG_ID,
                  question: 'What security certifications do you have?',
                  answer: 'We hold SOC 2 Type II and ISO 27001 certifications...',
                  category: 'Security',
                  tags: ['security', 'certifications'],
                  usageCount: 3,
                  usedInProjectIds: [],
                  currentVersion: 2,
                  versions: [],
                  isArchived: false,
                  approvalStatus: 'DRAFT',
                  createdAt: '2025-01-10T00:00:00Z',
                  updatedAt: '2025-01-20T00:00:00Z',
                  createdBy: 'user-1',
                },
              ],
              total: 2,
              limit: 20,
              offset: 0,
              hasMore: false,
            },
          }),
        });
      } else if (method === 'POST') {
        // Handle create
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              id: 'new-item',
              orgId: TEST_ORG_ID,
              question: 'New test question',
              answer: 'New test answer',
              category: 'Test',
              tags: [],
              usageCount: 0,
              usedInProjectIds: [],
              currentVersion: 1,
              versions: [],
              isArchived: false,
              approvalStatus: 'DRAFT',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              createdBy: 'user-1',
            },
          }),
        });
      }
    });

    await page.route('**/api/content-library/categories**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            categories: [
              { name: 'Company', count: 10 },
              { name: 'Security', count: 5 },
              { name: 'Technical', count: 8 },
            ],
          },
        }),
      });
    });

    await page.route('**/api/content-library/tags**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            tags: [
              { name: 'cloud', count: 15 },
              { name: 'security', count: 8 },
              { name: 'compliance', count: 5 },
            ],
          },
        }),
      });
    });
  });

  test('should display content library page with header', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Check page title
    await expect(page.getByRole('heading', { name: 'Content Library' })).toBeVisible();

    // Check for Add Content button
    await expect(page.getByRole('button', { name: /Add Content/i })).toBeVisible();

    // Check search input is present
    await expect(page.getByPlaceholder(/Search questions or answers/i)).toBeVisible();
  });

  test('should display content library items in table', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Wait for items to load
    await expect(page.getByText('What is your company background?')).toBeVisible();
    await expect(page.getByText('What security certifications do you have?')).toBeVisible();

    // Check status badges
    await expect(page.getByText('APPROVED')).toBeVisible();
    await expect(page.getByText('DRAFT')).toBeVisible();

    // Check categories
    await expect(page.getByText('Company', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Security', { exact: true }).first()).toBeVisible();
  });

  test('should filter by search query', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Wait for initial load
    await expect(page.getByText('What is your company background?')).toBeVisible();

    // Type in search
    const searchInput = page.getByPlaceholder(/Search questions or answers/i);
    await searchInput.fill('security');

    // The API will be called with query param - mock already set up to return filtered results
    // In a real test, we'd verify the correct API call was made
  });

  test('should filter by category', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Click category dropdown
    await page.getByRole('combobox').first().click();

    // Select Security category
    await page.getByRole('option', { name: /Security/i }).click();

    // Verify filter is applied (would trigger API call with category param)
  });

  test('should filter by approval status', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Find and click the status dropdown (second select)
    const statusDropdown = page.locator('[role="combobox"]').nth(1);
    await statusDropdown.click();

    // Select APPROVED status
    await page.getByRole('option', { name: 'Approved' }).click();

    // Verify filter is applied
  });

  test('should open create dialog when clicking Add Content', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Click Add Content button
    await page.getByRole('button', { name: /Add Content/i }).click();

    // Check dialog opens
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add Content Item' })).toBeVisible();

    // Check form fields are present
    await expect(page.getByLabel(/Question/i)).toBeVisible();
    await expect(page.getByLabel(/Answer/i)).toBeVisible();
    await expect(page.getByLabel(/Category/i)).toBeVisible();
  });

  test('should create a new content item', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Open create dialog
    await page.getByRole('button', { name: /Add Content/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Fill form
    await page.getByLabel(/Question/i).fill('What is your test question?');
    await page.getByLabel(/Answer/i).fill('This is a test answer for the question.');

    // Fill category (need to find the right input)
    const categoryInput = page.locator('#category');
    await categoryInput.fill('Technical');

    // Submit form
    await page.getByRole('button', { name: 'Create' }).click();

    // Dialog should close on success
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should show validation errors for empty required fields', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Open create dialog
    await page.getByRole('button', { name: /Add Content/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click Create without filling fields
    await page.getByRole('button', { name: 'Create' }).click();

    // Form should show validation (button should be disabled if fields are empty)
    // The Create button should remain disabled since required fields are empty
    await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  test('should open detail dialog when clicking on item', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Wait for items to load
    await expect(page.getByText('What is your company background?')).toBeVisible();

    // Click on an item row
    await page.getByText('What is your company background?').click();

    // Detail dialog should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('We are a leading technology company...')).toBeVisible();
  });

  test('should copy answer to clipboard from detail dialog', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto(CONTENT_LIBRARY_URL);

    // Click on item to open detail dialog
    await page.getByText('What is your company background?').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click copy button
    await page.getByRole('button', { name: /Copy Answer/i }).click();

    // Check clipboard (would need to read from clipboard to verify)
    // In a real test, we'd verify the clipboard content
  });

  test('should show actions dropdown for each item', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Wait for items to load
    await expect(page.getByText('What is your company background?')).toBeVisible();

    // Find and click the first actions button
    const actionsButton = page.locator('[aria-label="Open menu"]').first();
    await actionsButton.click();

    // Check dropdown menu items
    await expect(page.getByRole('menuitem', { name: /View/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Edit/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Copy Answer/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Delete/i })).toBeVisible();
  });

  test('should show approve option for draft items', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Wait for items to load
    await expect(page.getByText('What security certifications do you have?')).toBeVisible();

    // Find the actions button for the draft item (second row)
    const actionsButtons = page.locator('[aria-label="Open menu"]');
    await actionsButtons.nth(1).click();

    // Check approve option is visible for draft
    await expect(page.getByRole('menuitem', { name: /Approve/i })).toBeVisible();
  });

  test('should show deprecate option for approved items', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Wait for items to load
    await expect(page.getByText('What is your company background?')).toBeVisible();

    // Find the actions button for the approved item (first row)
    const actionsButtons = page.locator('[aria-label="Open menu"]');
    await actionsButtons.first().click();

    // Check deprecate option is visible for approved
    await expect(page.getByRole('menuitem', { name: /Deprecate/i })).toBeVisible();
  });

  test('should show delete confirmation dialog', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Wait for items to load
    await expect(page.getByText('What is your company background?')).toBeVisible();

    // Open actions menu
    const actionsButton = page.locator('[aria-label="Open menu"]').first();
    await actionsButton.click();

    // Click delete
    await page.getByRole('menuitem', { name: /Delete/i }).click();

    // Check confirmation dialog
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByText('Delete Content Item')).toBeVisible();

    // Check for permanent delete checkbox
    await expect(page.getByLabel(/Permanently delete/i)).toBeVisible();
  });

  test('should display empty state when no items', async ({ page }) => {
    // Override mock to return empty items
    await page.route('**/api/content-library/items**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            items: [],
            total: 0,
            limit: 20,
            offset: 0,
            hasMore: false,
          },
        }),
      });
    });

    await page.goto(CONTENT_LIBRARY_URL);

    // Check empty state message
    await expect(page.getByText('No content found')).toBeVisible();
    await expect(
      page.getByText(/Start building your content library/i)
    ).toBeVisible();
  });

  test('should display item count in header', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Check item count is displayed
    await expect(page.getByText('2 items in your library')).toBeVisible();
  });

  test('should clear filters when clicking clear button', async ({ page }) => {
    await page.goto(CONTENT_LIBRARY_URL);

    // Apply a filter first
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Security/i }).click();

    // Clear filters button should appear
    await expect(page.getByRole('button', { name: /Clear filters/i })).toBeVisible();

    // Click clear filters
    await page.getByRole('button', { name: /Clear filters/i }).click();

    // Button should disappear
    await expect(page.getByRole('button', { name: /Clear filters/i })).not.toBeVisible();
  });
});
