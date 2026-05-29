import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for Project pages.
 */
export class ProjectPage {
  readonly newProjectButton: Locator;
  readonly projectLinks: Locator;

  constructor(private page: Page) {
    this.newProjectButton = page.locator('button:has-text("New Project")');
    this.projectLinks = page.locator('a[href*="/projects/"]');
  }

  async expectNewProjectButtonVisible(): Promise<void> {
    await expect(this.newProjectButton).toBeVisible({ timeout: 5000 });
  }

  async openCreateDialog(): Promise<void> {
    await this.newProjectButton.click();
    await expect(this.page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  }

  async expectCreateDialogHasFields(): Promise<void> {
    const nameInput = this.page.locator('input#name');
    const descriptionInput = this.page.locator('textarea#description');
    await expect(nameInput).toBeVisible();
    await expect(descriptionInput).toBeVisible();
  }

  async expectCreateButtonDisabledWithoutName(): Promise<void> {
    const createButton = this.page.locator('button:has-text("Create")').last();
    await expect(createButton).toBeDisabled();
  }

  async navigateToFirstProject(): Promise<boolean> {
    const projectLink = this.projectLinks.first();
    if (!(await projectLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await projectLink.click();
    await this.page.waitForURL(/\/projects\/[a-zA-Z0-9-]+/);
    return true;
  }

  async expectProjectHeadingVisible(): Promise<void> {
    const heading = this.page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 5000 });
  }

  async expectProjectTabsVisible(): Promise<void> {
    const documentsTab = this.page.getByRole('link', { name: /documents/i });
    const questionsTab = this.page.getByRole('link', { name: /questions/i });
    const proposalsTab = this.page.getByRole('link', { name: /proposals/i });

    // At least one tab should be visible
    const hasDocuments = await documentsTab.isVisible({ timeout: 5000 }).catch(() => false);
    const hasQuestions = await questionsTab.isVisible({ timeout: 5000 }).catch(() => false);
    const hasProposals = await proposalsTab.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasDocuments || hasQuestions || hasProposals).toBeTruthy();
  }

  async hasProjects(): Promise<boolean> {
    return this.projectLinks.first().isVisible({ timeout: 5000 }).catch(() => false);
  }

  async expectProjectsOrEmptyState(): Promise<void> {
    const hasProjects = await this.hasProjects();
    const emptyState = this.page.getByText(/no projects|create.*project|get started/i);
    const hasEmptyState = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasProjects || hasEmptyState).toBeTruthy();
  }

  async clickDeleteOnFirstProject(): Promise<boolean> {
    const deleteButton = this.page.locator('button:has([class*="Trash"]), button[aria-label*="Delete"]').first();
    if (!(await deleteButton.isVisible({ timeout: 3000 }).catch(() => false))) {
      return false;
    }
    await deleteButton.click();
    return true;
  }

  async expectDeleteConfirmationDialog(): Promise<void> {
    const confirmDialog = this.page.locator('[role="alertdialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await expect(this.page.locator('button:has-text("Delete")')).toBeVisible();
    await expect(this.page.locator('button:has-text("Cancel")')).toBeVisible();
  }

  async cancelDeleteDialog(): Promise<void> {
    await this.page.locator('button:has-text("Cancel")').click();
    await expect(this.page.locator('[role="alertdialog"]')).toBeHidden({ timeout: 3000 });
  }
}