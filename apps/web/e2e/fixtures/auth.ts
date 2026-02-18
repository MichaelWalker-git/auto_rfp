import { test as base, type Page } from '@playwright/test';
import { NavigationHelper } from '../helpers/navigation';
import { JSErrorCollector } from '../helpers/errors';
import { OrganizationsPage } from '../pages/organizations.page';
import { ProjectPage } from '../pages/project.page';
import { SettingsPage } from '../pages/settings.page';
import { KnowledgeBasePage } from '../pages/knowledge-base.page';
import { OpportunitiesPage } from '../pages/opportunities.page';

/**
 * Custom fixture types for authenticated tests.
 */
interface AuthFixtures {
  /** Navigation helper for common navigation patterns */
  nav: NavigationHelper;
  /** JS error collector - automatically attached to the page */
  errorCollector: JSErrorCollector;
  /** Organizations page object */
  orgsPage: OrganizationsPage;
  /** Project page object */
  projectPage: ProjectPage;
  /** Settings page object */
  settingsPage: SettingsPage;
  /** Knowledge Base page object */
  kbPage: KnowledgeBasePage;
  /** Opportunities page object */
  opportunitiesPage: OpportunitiesPage;
}

/**
 * Extended test with authentication auto-skip and page object fixtures.
 *
 * Usage:
 * ```ts
 * import { test, expect } from '../fixtures/auth';
 *
 * test('my authenticated test', async ({ page, nav, orgsPage }) => {
 *   await nav.goToFirstOrganization();
 *   await orgsPage.expectLoaded();
 * });
 * ```
 *
 * All tests using this fixture will automatically skip if
 * E2E_TEST_EMAIL is not set.
 */
export const test = base.extend<AuthFixtures>({
  // Auto-skip unauthenticated runs
  page: async ({ page }, use) => {
    if (!process.env.E2E_TEST_EMAIL) {
      test.skip();
    }
    await use(page);
  },

  nav: async ({ page }, use) => {
    await use(new NavigationHelper(page));
  },

  errorCollector: async ({ page }, use) => {
    const collector = new JSErrorCollector(page);
    await use(collector);
    collector.dispose();
  },

  orgsPage: async ({ page }, use) => {
    await use(new OrganizationsPage(page));
  },

  projectPage: async ({ page }, use) => {
    await use(new ProjectPage(page));
  },

  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },

  kbPage: async ({ page }, use) => {
    await use(new KnowledgeBasePage(page));
  },

  opportunitiesPage: async ({ page }, use) => {
    await use(new OpportunitiesPage(page));
  },
});

export { expect } from '@playwright/test';