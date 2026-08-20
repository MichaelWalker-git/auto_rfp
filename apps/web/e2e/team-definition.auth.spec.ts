import { test, expect } from './fixtures/auth';
import { EmployeesPage } from './pages/employees.page';

/**
 * E2E coverage for the Team Definition feature against a real backend:
 * the org-level Team (employees) page, the CV-import entry point, and the
 * solution plan's Team Definition section.
 *
 * The employee CRUD test cleans up after itself (create → edit → delete),
 * so repeated runs leave the org's pool unchanged.
 */

const extractOrgId = (url: string): string | null =>
  url.match(/\/organizations\/([a-zA-Z0-9-]+)/)?.[1] ?? null;

test.describe('Team page (employees)', () => {
  let orgId: string;

  test.beforeEach(async ({ page, nav }) => {
    const href = await nav.goToFirstOrganization();
    const id = href ? extractOrgId(href) : extractOrgId(page.url());
    test.skip(!id, 'No organization available for the test user');
    orgId = id as string;
  });

  test('renders the employees list page with table or empty state', async ({
    page,
    errorCollector,
  }) => {
    const employees = new EmployeesPage(page);
    await employees.goto(orgId);
    await employees.expectLoaded();
    errorCollector.expectNoCriticalErrors();
  });

  test('shows the Generate from CVs action', async ({ page }) => {
    const employees = new EmployeesPage(page);
    await employees.goto(orgId);
    await employees.expectLoaded();
    // Both the toolbar action and the empty-state action can render at once;
    // assert at least one is visible without tripping strict mode.
    await expect(
      employees.generateFromCvsButton.or(page.getByTestId('employee-empty-generate')).first(),
    ).toBeVisible();
  });

  test('creates, edits, and deletes an employee (full CRUD via deployed API)', async ({
    page,
    errorCollector,
  }) => {
    const employees = new EmployeesPage(page);
    const name = `E2E Test Employee ${Date.now()}`;

    await employees.goto(orgId);
    await employees.expectLoaded();

    // Create
    await employees.createEmployee({
      name,
      primaryRole: 'QA Engineer',
      certifications: 'ISTQB',
      location: 'Onshore',
    });
    await employees.expectLoaded();
    await expect(employees.rowByName(name).first()).toBeVisible({ timeout: 20000 });

    // Edit — change the name suffix and save
    await employees.openEditByName(name);
    const nameInput = page.getByTestId('employee-form-name');
    await expect(nameInput).toHaveValue(name, { timeout: 15000 });
    const editedName = `${name} (edited)`;
    await nameInput.fill(editedName);
    await page.getByTestId('employee-form-submit').click();
    await page.waitForURL(/\/employees\/?(\?.*)?$/, { timeout: 20000 });
    await expect(employees.rowByName(editedName).first()).toBeVisible({ timeout: 20000 });

    // Search narrows to the created row
    await employees.search(editedName);
    await expect(employees.rowByName(editedName).first()).toBeVisible();

    // Delete (cleanup)
    await employees.search('');
    await employees.deleteByName(editedName);

    errorCollector.expectNoCriticalErrors();
  });
});

test.describe('Solution plan — Team Definition section', () => {
  test('shows the team section on a ready solution plan', async ({ page, nav }) => {
    const href = await nav.goToFirstOrganization();
    test.skip(!href && !extractOrgId(page.url()), 'No organization available');

    // Walk to the first opportunity that has a solution plan panel.
    const projectHref = await nav.goToFirstProject();
    test.skip(!projectHref, 'No project available for the test user');

    await nav.goToOpportunities();
    const oppLink = page.locator('a[href*="/opportunities/"]').first();
    const hasOpp = await oppLink.isVisible({ timeout: 10000 }).catch(() => false);
    test.skip(!hasOpp, 'No opportunity available for the test user');
    await oppLink.click();
    await page.waitForLoadState('networkidle');

    // The Team Definition section only renders inside a READY plan.
    const teamSection = page.getByTestId('team-definition-section');
    const planReady = await teamSection
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!planReady, 'No READY solution plan on the first opportunity');

    // One of the section's states must be shown: a generated team, the
    // not-generated state, or the empty-pool prerequisite.
    await expect(
      page
        .getByTestId('team-view-table')
        .or(page.getByTestId('team-not-generated'))
        .or(page.getByTestId('team-empty-pool')),
    ).toBeVisible({ timeout: 15000 });

    // The Team Qualifications entry point (generate action or its guidance)
    // must be present whenever the team section is rendered.
    await expect(
      page
        .getByTestId('team-generate-qualifications')
        .or(page.getByTestId('team-qualifications-guidance')),
    ).toBeVisible();
  });
});
