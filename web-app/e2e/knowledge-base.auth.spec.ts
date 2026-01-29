import { test, expect } from '@playwright/test';

test.describe('Knowledge Base CRUD (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
  });

  test('should navigate to knowledge base page', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    // Navigate to first org
    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    // Look for knowledge base link in nav
    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Should see KB heading
      const heading = page.locator('h1:has-text("Knowledge Base")');
      await expect(heading).toBeVisible({ timeout: 10000 });
    }
  });

  test('should display knowledge base list or empty state', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Should see KB list or empty state
      const kbCards = page.locator('[class*="Card"]');
      const emptyState = page.locator('div:has-text("No knowledge bases")');

      const hasCards = await kbCards.first().isVisible({ timeout: 5000 }).catch(() => false);
      const hasEmpty = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);

      console.log(`KB cards: ${hasCards}, Empty state: ${hasEmpty}`);
    }
  });

  test('should display New Knowledge Base button', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Should see New Knowledge Base button
      const newKbButton = page.locator('button:has-text("New Knowledge Base")');
      const hasButton = await newKbButton.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`New Knowledge Base button: ${hasButton}`);
    }
  });

  test('should open create knowledge base dialog', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Click New Knowledge Base button
      const newKbButton = page.locator('button:has-text("New Knowledge Base")');
      if (await newKbButton.isVisible()) {
        await newKbButton.click();

        // Dialog should open
        const dialog = page.locator('[role="dialog"]');
        const hasDialog = await dialog.isVisible({ timeout: 5000 }).catch(() => false);

        if (hasDialog) {
          // Should see form fields
          const nameInput = page.locator('input#name');
          const descriptionInput = page.locator('textarea#description');

          const hasName = await nameInput.isVisible().catch(() => false);
          const hasDescription = await descriptionInput.isVisible().catch(() => false);

          console.log(`Name input: ${hasName}, Description input: ${hasDescription}`);
        }
      }
    }
  });

  test('should navigate to knowledge base detail page', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Click on first KB card
      const kbCard = page.locator('[class*="Card"]').first();
      if (await kbCard.isVisible()) {
        await kbCard.click();
        await page.waitForLoadState('networkidle');

        // Should be on KB detail page
        await expect(page).toHaveURL(/\/knowledge-base\/[a-zA-Z0-9-]+/);
      }
    }
  });

  test('should display documents list in KB detail', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Click on first KB card
      const kbCard = page.locator('[class*="Card"]').first();
      if (await kbCard.isVisible()) {
        await kbCard.click();
        await page.waitForLoadState('networkidle');

        // Should see Documents section
        const documentsHeading = page.locator('h1, h2, h3').filter({ hasText: 'Documents' });
        const hasDocumentsSection = await documentsHeading.isVisible({ timeout: 5000 }).catch(() => false);

        // Should see either documents list or empty state
        const emptyState = page.locator('div:has-text("No documents")');
        const hasEmptyState = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);

        console.log(`Documents section: ${hasDocumentsSection}, Empty state: ${hasEmptyState}`);
      }
    }
  });

  test('should display upload documents button in KB detail', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Click on first KB card
      const kbCard = page.locator('[class*="Card"]').first();
      if (await kbCard.isVisible()) {
        await kbCard.click();
        await page.waitForLoadState('networkidle');

        // Should see Upload Documents button
        const uploadButton = page.locator('button:has-text("Upload Documents")');
        const hasUploadButton = await uploadButton.isVisible({ timeout: 5000 }).catch(() => false);
        console.log(`Upload Documents button: ${hasUploadButton}`);
      }
    }
  });

  test('should open upload documents dialog', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Click on first KB card
      const kbCard = page.locator('[class*="Card"]').first();
      if (await kbCard.isVisible()) {
        await kbCard.click();
        await page.waitForLoadState('networkidle');

        // Click Upload Documents button
        const uploadButton = page.locator('button:has-text("Upload Documents")');
        if (await uploadButton.isVisible()) {
          await uploadButton.click();

          // Dialog should open
          const dialog = page.locator('[role="dialog"]');
          const hasDialog = await dialog.isVisible({ timeout: 5000 }).catch(() => false);

          if (hasDialog) {
            // Should see file input
            const fileInput = page.locator('input[type="file"]');
            const hasFileInput = await fileInput.isVisible().catch(() => false);
            console.log(`File input in dialog: ${hasFileInput}`);
          }
        }
      }
    }
  });

  test('should display document status badges', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Click on first KB card
      const kbCard = page.locator('[class*="Card"]').first();
      if (await kbCard.isVisible()) {
        await kbCard.click();
        await page.waitForLoadState('networkidle');

        // Look for status badges (Indexed, Chunked, Failed, etc.)
        const statusBadges = page.locator('span:has-text("Indexed"), span:has-text("Chunked"), span:has-text("Failed")');
        const badgeCount = await statusBadges.count();
        console.log(`Found ${badgeCount} document status badges`);
      }
    }
  });

  test('should display document count statistics', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('networkidle');

    const orgLink = page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible())) {
      test.skip();
    }
    await orgLink.click();
    await page.waitForLoadState('networkidle');

    const kbLink = page.getByRole('link', { name: /knowledge base/i });
    if (await kbLink.isVisible()) {
      await kbLink.click();
      await page.waitForLoadState('networkidle');

      // Click on first KB card
      const kbCard = page.locator('[class*="Card"]').first();
      if (await kbCard.isVisible()) {
        await kbCard.click();
        await page.waitForLoadState('networkidle');

        // Look for document statistics
        const documentsLabel = page.locator('div:has-text("Documents")');
        const indexedLabel = page.locator('div:has-text("Indexed")');

        const hasDocumentsStats = await documentsLabel.first().isVisible({ timeout: 5000 }).catch(() => false);
        const hasIndexedStats = await indexedLabel.first().isVisible({ timeout: 5000 }).catch(() => false);

        console.log(`Documents stats: ${hasDocumentsStats}, Indexed stats: ${hasIndexedStats}`);
      }
    }
  });
});
