import { test, expect } from './fixtures/auth';
import { PhysicalSubmissionPage } from './pages/physical-submission.page';

/**
 * Physical Submission Detection e2e (docs/physical-submission-check) — runs
 * against a REAL environment (deployed dev backend + this branch's frontend):
 *
 *   PLAYWRIGHT_BASE_URL=...              frontend under test
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD   real Cognito login
 *   E2E_PS_PHYSICAL_OPP_PATH             opportunity with a detected physical
 *                                        (or BOTH) submission requirement —
 *                                        banner + chip must be visible
 *   E2E_PS_ELECTRONIC_OPP_PATH           opportunity with submissionMethod
 *                                        ELECTRONIC/UNKNOWN — banner must be
 *                                        absent (optional negative case)
 *
 * Paths look like /organizations/{orgId}/projects/{projectId}/opportunities/{oppId}.
 * Both suites are skipped when their env var is unset, mirroring the
 * E2E_TEST_EMAIL auto-skip used across this e2e suite.
 *
 * The toggle test never mutates real dev data: the banner's switch has no
 * UI path back to PHYSICAL once flipped off (PhysicalSubmissionBanner
 * unmounts itself the moment submissionMethod stops being physical), so a
 * real toggle-off here would permanently overwrite the fixture opportunity.
 * Instead it intercepts the PUT/GET pair to assert the exact request the
 * frontend sends and that the UI reacts correctly to the response contract.
 */

const PHYSICAL_OPP_PATH = process.env.E2E_PS_PHYSICAL_OPP_PATH;
const ELECTRONIC_OPP_PATH = process.env.E2E_PS_ELECTRONIC_OPP_PATH;

test.describe('Physical Submission Detection — detail page banner', () => {
  test.skip(!PHYSICAL_OPP_PATH, 'E2E_PS_PHYSICAL_OPP_PATH not set');

  test('shows the warning banner with method, address, deadline, and a checked toggle', async ({
    physicalSubmissionPage,
  }) => {
    await physicalSubmissionPage.gotoOpportunity(PHYSICAL_OPP_PATH!);

    const opportunity = physicalSubmissionPage.getLatestOpportunity();
    expect(
      opportunity?.submissionMethod,
      'fixture opportunity must have a PHYSICAL or BOTH submissionMethod — repoint E2E_PS_PHYSICAL_OPP_PATH',
    ).toMatch(/^(PHYSICAL|BOTH)$/);

    const banner = physicalSubmissionPage.banner;
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText(
      new RegExp(`Physical Submission Required \\(${opportunity!.submissionMethod}\\)`),
    );

    if (opportunity?.submissionMailingAddress) {
      await expect(physicalSubmissionPage.address).toContainText('Mail to:');
    }
    if (opportunity?.responseDeadlineIso) {
      await expect(physicalSubmissionPage.deadline).toContainText('Mail by');
    }

    await expect(physicalSubmissionPage.toggle).toBeChecked();
  });

  test('surfaces the matching Physical Mail chip on the project opportunities list', async ({
    physicalSubmissionPage,
  }) => {
    await physicalSubmissionPage.gotoOpportunity(PHYSICAL_OPP_PATH!);
    const title = physicalSubmissionPage.getLatestOpportunity()?.title;
    expect(title, 'opportunity must have a title to locate its list card').toBeTruthy();

    await physicalSubmissionPage.gotoList(PHYSICAL_OPP_PATH!);

    const card = physicalSubmissionPage.cardWithTitle(title!);
    await expect(card.first()).toBeVisible({ timeout: 15_000 });

    const chip = physicalSubmissionPage.chip(card.first());
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('Physical Mail');
    await expect(chip).toHaveAttribute('aria-label', 'Physical submission required');
  });

  test('toggling the switch off sends the correct patch and hides the banner', async ({
    page,
    physicalSubmissionPage,
  }) => {
    const { projectId, oppId } = PhysicalSubmissionPage.parseOpportunityPath(PHYSICAL_OPP_PATH!);
    await physicalSubmissionPage.gotoOpportunity(PHYSICAL_OPP_PATH!);
    const opportunity = physicalSubmissionPage.getLatestOpportunity();

    // Intercept the mutation: assert the exact request, but never let it reach
    // the real backend (see file header — there is no UI path to undo it).
    await page.route('**/opportunity/update-opportunity**', async (route) => {
      expect(route.request().method()).toBe('PUT');
      expect(route.request().postDataJSON()).toEqual({
        projectId,
        oppId,
        patch: { submissionMethod: 'ELECTRONIC' },
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // The banner calls refetch() after a successful mutation — return the
    // same opportunity with the field flipped, as the real backend would.
    await page.route('**/opportunity/get-opportunity**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...opportunity, submissionMethod: 'ELECTRONIC' }),
      });
    });

    await physicalSubmissionPage.toggle.click();

    await expect(physicalSubmissionPage.banner).not.toBeVisible({ timeout: 15_000 });
    await expect(physicalSubmissionPage.section).toBeVisible();

    await page.unroute('**/opportunity/update-opportunity**');
    await page.unroute('**/opportunity/get-opportunity**');
  });
});

test.describe('Physical Submission Detection — negative case', () => {
  test.skip(!ELECTRONIC_OPP_PATH, 'E2E_PS_ELECTRONIC_OPP_PATH not set');

  test('does not render the banner for a non-physical-submission opportunity', async ({
    physicalSubmissionPage,
  }) => {
    await physicalSubmissionPage.gotoOpportunity(ELECTRONIC_OPP_PATH!);

    const opportunity = physicalSubmissionPage.getLatestOpportunity();
    expect(
      opportunity?.submissionMethod === 'PHYSICAL' || opportunity?.submissionMethod === 'BOTH',
      'fixture opportunity must NOT be PHYSICAL/BOTH — repoint E2E_PS_ELECTRONIC_OPP_PATH',
    ).toBe(false);

    await expect(physicalSubmissionPage.banner).not.toBeVisible();
  });
});
