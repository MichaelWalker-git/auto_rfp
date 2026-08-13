import { test, expect } from './fixtures/auth';

/**
 * Solution Plan e2e (T14) — runs against a REAL environment (deployed dev
 * backend + this branch's frontend), no mocked backend:
 *
 *   PLAYWRIGHT_BASE_URL=...            frontend under test
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD real Cognito login
 *   E2E_SP_BLOCKED_OPP_PATH            opportunity WITHOUT a plan, WITHOUT
 *                                      generated documents (gate active,
 *                                      not grandfathered — ADR-10)
 *   E2E_SP_HAPPY_OPP_PATH              opportunity WITH solicitation files
 *                                      (grilling context) — a plan run is
 *                                      started/regenerated on it for real
 *
 * Paths look like /organizations/{orgId}/projects/{projectId}/opportunities/{oppId}.
 * Both tests are skipped when their env var is unset, mirroring the
 * E2E_TEST_EMAIL auto-skip. The org must have `enableSolutionPlan` on.
 *
 * The happy path drives a real grilling run (multiple model calls over SQS
 * rounds + synthesis), so its timeout is minutes, not seconds.
 *
 * Intentional non-cleanup: the run leaves the plan (regenerated next run —
 * versions are monotonic, ADR-11) and one generated Cost Proposal per run on
 * the happy-path opportunity. There is no plan-delete API, and keeping the
 * artifacts makes runs inspectable on dev; prune the documents occasionally.
 */

const BLOCKED_OPP_PATH = process.env.E2E_SP_BLOCKED_OPP_PATH;
const HAPPY_OPP_PATH = process.env.E2E_SP_HAPPY_OPP_PATH;

/** Ceiling for a full grilling run (rounds + synthesis) on dev. */
const PLAN_READY_TIMEOUT_MS = 15 * 60_000;
/** Ceiling for the first Griller question to appear in the live transcript. */
const FIRST_QUESTION_TIMEOUT_MS = 5 * 60_000;
/** Ceiling for the async document-generation worker after the request is queued. */
const DOCUMENT_GENERATED_TIMEOUT_MS = 10 * 60_000;

test.describe('Solution Plan — generation gate (blocked state)', () => {
  test.skip(!BLOCKED_OPP_PATH, 'E2E_SP_BLOCKED_OPP_PATH not set');

  test('blocks gated document generation before a plan exists', async ({
    solutionPlanPage,
  }) => {
    test.setTimeout(180_000);
    await solutionPlanPage.gotoOpportunity(BLOCKED_OPP_PATH!);

    // Precondition on dev data: the opportunity must have no plan (and no
    // grandfathered documents). If someone ran a plan on it, this fails here —
    // repoint E2E_SP_BLOCKED_OPP_PATH at a plan-less opportunity.
    await expect(
      solutionPlanPage.startButton,
      'blocked-state opportunity already has a Solution Plan — pick another',
    ).toBeVisible({ timeout: 30_000 });

    // The generate dialog is gated: callout + disabled gated types.
    await solutionPlanPage.openGenerateDialog();
    await expect(solutionPlanPage.gateCallout).toBeVisible({ timeout: 15_000 });
    await expect(solutionPlanPage.gateCallout).toContainText(
      'Create a Solution Plan first',
    );

    const gatedCheckbox = solutionPlanPage.documentTypeCheckbox('TECHNICAL_PROPOSAL');
    await expect(gatedCheckbox).toBeDisabled();
    await expect(
      solutionPlanPage.generateDialog.getByText('Requires Solution Plan').first(),
    ).toBeVisible();

    // Exempt Q&A-style types stay generatable (T9/T12).
    const exemptCheckbox = solutionPlanPage.documentTypeCheckbox('CLARIFYING_QUESTIONS');
    await expect(exemptCheckbox).toBeEnabled();

    // A hard-blocked opportunity gets the callout, not the ADR-10 nudge.
    await expect(solutionPlanPage.nudgeBanner).not.toBeVisible();

    await solutionPlanPage.closeGenerateDialog();
  });
});

test.describe('Solution Plan — happy path (real backend)', () => {
  test.skip(!HAPPY_OPP_PATH, 'E2E_SP_HAPPY_OPP_PATH not set');

  test('init plan → grilling transcript → READY → document generation succeeds', async ({
    page,
    solutionPlanPage,
  }) => {
    test.setTimeout(PLAN_READY_TIMEOUT_MS + DOCUMENT_GENERATED_TIMEOUT_MS + 5 * 60_000);
    await solutionPlanPage.gotoOpportunity(HAPPY_OPP_PATH!);

    // Works on both a fresh opportunity (Start) and one with an existing
    // plan (Regenerate + confirm), so the test is re-runnable.
    await solutionPlanPage.startOrRegenerateRun();

    // Live transcript: at least one Griller question appears while GRILLING.
    await expect(solutionPlanPage.interviewerMessages.first()).toBeVisible({
      timeout: FIRST_QUESTION_TIMEOUT_MS,
    });

    // The panel polls every 3s; wait for the run to finish for real.
    await solutionPlanPage.waitForReady(PLAN_READY_TIMEOUT_MS);
    await expect(solutionPlanPage.statusBadge(/^ready$/i).first()).toBeVisible();

    // Gate is open now: no callout, gated types selectable, generation accepted.
    await solutionPlanPage.openGenerateDialog();
    await expect(solutionPlanPage.gateCallout).not.toBeVisible();

    const costProposalCheckbox = solutionPlanPage.documentTypeCheckbox('COST_PROPOSAL');
    await expect(costProposalCheckbox).toBeEnabled({ timeout: 15_000 });
    await costProposalCheckbox.check();

    // Server must accept the request (no SOLUTION_PLAN_REQUIRED 409).
    const [generateResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/generate-document') && res.request().method() === 'POST',
        { timeout: 60_000 },
      ),
      solutionPlanPage.generateDialog
        .getByRole('button', { name: /generate \(\d+\)/i })
        .click(),
    ]);
    // 202 Accepted — generation is queued to the async worker.
    expect(generateResponse.status()).toBe(202);

    // The toast text also lands in the aria-live region — match the first.
    await expect(page.getByText(/queued for generation/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // "Succeeds" means the async worker finishes, not just that it queued.
    await solutionPlanPage.waitForDocumentGenerated(
      'Cost Proposal',
      DOCUMENT_GENERATED_TIMEOUT_MS,
    );
  });
});
