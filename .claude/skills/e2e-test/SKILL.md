---
name: e2e-test
description: Create Playwright end-to-end tests with authentication fixtures, page objects, and proper test patterns
---

# E2E Test Creation (Playwright)

When creating end-to-end tests in this project, follow these exact steps:

## 1. File Location

Create `apps/web/e2e/<feature>.auth.spec.ts` (`.auth.` suffix for authenticated tests).

## 2. Test Template

```typescript
import { test, expect } from '@playwright/test';
import { AuthFixture } from './fixtures/auth-fixture';

test.describe('<Feature> Management', () => {
  let auth: AuthFixture;

  test.beforeAll(async ({ browser }) => {
    auth = new AuthFixture(browser);
    await auth.login();
  });

  test.afterAll(async () => {
    await auth.cleanup();
  });

  test('should display <feature> list page', async ({ page }) => {
    await page.goto('/<feature>');
    await expect(page.getByRole('heading', { name: /<Features>/i })).toBeVisible();
  });

  test('should create a new <feature>', async ({ page }) => {
    await page.goto('/<feature>/create');

    // Fill form
    await page.getByLabel('Name').fill('Test Feature');
    await page.getByLabel('Description').fill('Test description');

    // Submit
    await page.getByRole('button', { name: /create/i }).click();

    // Verify redirect and success
    await expect(page).toHaveURL(/<feature>/);
    await expect(page.getByText('Test Feature')).toBeVisible();
  });

  test('should show validation errors on empty form', async ({ page }) => {
    await page.goto('/<feature>/create');
    await page.getByRole('button', { name: /create/i }).click();

    // Verify validation messages
    await expect(page.getByText(/required/i)).toBeVisible();
  });

  test('should edit an existing <feature>', async ({ page }) => {
    await page.goto('/<feature>');

    // Click on item to navigate to edit
    await page.getByText('Test Feature').click();
    await page.getByRole('link', { name: /edit/i }).click();

    // Modify
    await page.getByLabel('Name').clear();
    await page.getByLabel('Name').fill('Updated Feature');
    await page.getByRole('button', { name: /save|update/i }).click();

    // Verify
    await expect(page.getByText('Updated Feature')).toBeVisible();
  });

  test('should delete a <feature>', async ({ page }) => {
    await page.goto('/<feature>');
    await page.getByText('Updated Feature').click();
    await page.getByRole('button', { name: /delete/i }).click();

    // Confirm deletion dialog
    await page.getByRole('button', { name: /confirm/i }).click();

    // Verify removed
    await expect(page.getByText('Updated Feature')).not.toBeVisible();
  });
});
```

## 3. Page Object Pattern

Create `apps/web/e2e/pages/<feature>.page.ts`:

```typescript
import type { Page } from '@playwright/test';

export class <Feature>Page {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/<feature>');
  }

  async gotoCreate() {
    await this.page.goto('/<feature>/create');
  }

  async fillForm(data: { name: string; description?: string }) {
    await this.page.getByLabel('Name').fill(data.name);
    if (data.description) {
      await this.page.getByLabel('Description').fill(data.description);
    }
  }

  async submit() {
    await this.page.getByRole('button', { name: /create|save/i }).click();
  }

  async getItems() {
    return this.page.getByTestId('<feature>-item').all();
  }
}
```

## 4. Test Helpers

Use helpers from `apps/web/e2e/helpers/`:

```typescript
import { waitForApiResponse } from './helpers/api';

// Wait for specific API call to complete
await waitForApiResponse(page, '/<feature>/create', 200);
```

## 5. Hard Rules

- **Use `.auth.spec.ts` suffix** for tests requiring authentication
- **Use `getByRole`, `getByLabel`, `getByText`** — never CSS selectors for user-facing elements
- **Use `data-testid` only as last resort** — prefer accessible selectors
- **Each test should be independent** — don't rely on test execution order
- **Clean up test data** in `afterAll` or `afterEach`
- **Use page objects** for complex pages to reduce duplication
- **Wait for network** — use `waitForResponse` or `waitForLoadState` before assertions
- **Test loading states** — verify skeletons appear before data loads
- **Test empty states** — verify correct messaging when no data exists

## 6. Run Tests

```bash
cd apps/web && pnpm test:e2e
cd apps/web && pnpm test:e2e --ui  # With Playwright UI
cd apps/web && pnpm test:e2e --grep "<feature>"  # Run specific tests
```
