import { type Page, expect } from '@playwright/test';

/**
 * Navigation helper that encapsulates common navigation patterns.
 * Eliminates the repeated org → project → section navigation boilerplate.
 */
export class NavigationHelper {
  constructor(private page: Page) {}

  /** Navigate to organizations list page */
  async goToOrganizations(): Promise<void> {
    await this.page.goto('/organizations');
    await this.page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Navigate to the first available organization.
   * @returns The org URL path, or null if no orgs exist.
   */
  async goToFirstOrganization(): Promise<string | null> {
    await this.goToOrganizations();

    const orgLink = this.page.locator('a[href*="/organizations/"]').first();
    if (!(await orgLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      return null;
    }

    const href = await orgLink.getAttribute('href');
    await orgLink.click();
    await this.page.waitForURL(/\/organizations\/[a-zA-Z0-9-]+/);
    return href;
  }

  /**
   * Navigate to the first available project within the first organization.
   * @returns The project URL path, or null if no projects exist.
   */
  async goToFirstProject(): Promise<string | null> {
    const orgHref = await this.goToFirstOrganization();
    if (!orgHref) return null;

    const projectLink = this.page.locator('a[href*="/projects/"]').first();
    if (!(await projectLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      return null;
    }

    const href = await projectLink.getAttribute('href');
    await projectLink.click();
    await this.page.waitForURL(/\/projects\/[a-zA-Z0-9-]+/);
    return href;
  }

  /** Navigate to a specific section within the current project */
  async goToProjectSection(sectionName: string): Promise<boolean> {
    const sectionLink = this.page.getByRole('link', { name: new RegExp(sectionName, 'i') });
    if (!(await sectionLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await sectionLink.click();
    await this.page.waitForURL(new RegExp(sectionName.toLowerCase().replace(/\s+/g, '-')));
    return true;
  }

  /** Navigate to organization settings */
  async goToSettings(): Promise<boolean> {
    const settingsLink = this.page.getByRole('link', { name: /settings/i });
    if (!(await settingsLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await settingsLink.click();
    await expect(this.page.locator('h1:has-text("Organization Settings")')).toBeVisible({ timeout: 10000 });
    return true;
  }

  /** Navigate to knowledge base section */
  async goToKnowledgeBase(): Promise<boolean> {
    const kbLink = this.page.getByRole('link', { name: /knowledge base/i });
    if (!(await kbLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await kbLink.click();
    await expect(this.page.locator('h1:has-text("Knowledge Base")')).toBeVisible({ timeout: 10000 });
    return true;
  }

  /** Navigate to the first knowledge base detail page */
  async goToFirstKnowledgeBase(): Promise<boolean> {
    const navigated = await this.goToKnowledgeBase();
    if (!navigated) return false;

    const kbCard = this.page.locator('a[href*="/knowledge-base/"]').first();
    if (!(await kbCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await kbCard.click();
    await this.page.waitForURL(/\/knowledge-base\/[a-zA-Z0-9-]+/);
    return true;
  }

  /** Navigate to opportunities page */
  async goToOpportunities(): Promise<void> {
    await this.page.goto('/opportunities');
    await expect(this.page.locator('h1:has-text("Opportunities")')).toBeVisible({ timeout: 10000 });
  }

  /** Navigate to questions section within a project */
  async goToQuestions(): Promise<boolean> {
    const questionsLink = this.page.getByRole('link', { name: /questions/i });
    if (!(await questionsLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await questionsLink.click();
    return true;
  }

  /** Navigate to proposals section within a project */
  async goToProposals(): Promise<boolean> {
    const proposalsLink = this.page.getByRole('link', { name: /proposals/i });
    if (!(await proposalsLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await proposalsLink.click();
    return true;
  }
}