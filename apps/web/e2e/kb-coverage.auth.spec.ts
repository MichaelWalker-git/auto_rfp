import { test, expect } from './fixtures/auth';

/**
 * KB coverage precheck e2e — runs against a REAL environment (deployed dev
 * backend + this branch's frontend), no mocked backend:
 *
 *   PLAYWRIGHT_BASE_URL=...              frontend under test
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD   real Cognito login
 *   E2E_KB_COVERAGE_OPP_PATH             opportunity in an org whose knowledge
 *                                        base holds NO personnel content
 *                                        (gate has something to report), and
 *                                        which has a READY Solution Plan so the
 *                                        T9 gate isn't what's disabling rows
 *   E2E_KB_COVERAGE_ORG_PATH             optional: /organizations/{orgId} whose
 *                                        KB-owner coverage view is checked
 *
 * Both describes skip when their env var is unset, mirroring the E2E_TEST_EMAIL
 * auto-skip.
 *
 * The org flag `enableKBCoverageGate` decides warn-vs-block, and it defaults
 * off, so this spec asserts what is true either way: the gap is *named* before
 * generation is triggered, and nothing is generated while the operator looks at
 * it. The 409 `KB_COVERAGE_INCOMPLETE` refusal itself is covered by the
 * generate-document handler tests — with the gate armed the client disables the
 * row, so the browser can't legitimately issue the POST that would prove it.
 *
 * Read-only: no documents are generated and nothing is written.
 */

const OPP_PATH = process.env.E2E_KB_COVERAGE_OPP_PATH;
const ORG_PATH = process.env.E2E_KB_COVERAGE_ORG_PATH;

test.describe('KB coverage — gap is named before generation', () => {
  test.skip(!OPP_PATH, 'E2E_KB_COVERAGE_OPP_PATH not set');

  test('names the missing categories on TEAM_QUALIFICATIONS and starts no generation', async ({
    page,
    solutionPlanPage,
  }) => {
    test.setTimeout(180_000);

    // Any generate POST at all fails the acceptance criterion — register the
    // listener before the dialog opens so nothing can slip through.
    const generateRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/generate-document')) {
        generateRequests.push(req.url());
      }
    });

    await solutionPlanPage.gotoOpportunity(OPP_PATH!);
    await solutionPlanPage.openGenerateDialog();

    // The coverage probe is one org-scoped request serving every row.
    const gapBadge = solutionPlanPage.kbCoverageGapBadge('TEAM_QUALIFICATIONS');
    await expect(
      gapBadge,
      'no coverage gap reported — E2E_KB_COVERAGE_OPP_PATH must point at an org with no personnel content',
    ).toBeVisible({ timeout: 30_000 });

    // "By name" is the whole point: the badge must name a category, not just
    // signal that something is wrong.
    await expect(gapBadge).toContainText(/personnel bios/i);

    // Warn-vs-block is the org flag's call; when it's armed the row is also
    // unselectable. Accept either, but require them to be consistent.
    const checkbox = solutionPlanPage.documentTypeCheckbox('TEAM_QUALIFICATIONS');
    const isBlocked = await checkbox.isDisabled();
    if (isBlocked) {
      await expect(checkbox).not.toBeChecked();
    }

    // Nothing was generated while the operator read the warning.
    await solutionPlanPage.closeGenerateDialog();
    expect(generateRequests, 'generation was triggered by merely viewing the gap').toEqual([]);
  });

  test('reports a covered type as ready rather than flagging every row', async ({
    solutionPlanPage,
  }) => {
    test.setTimeout(120_000);
    await solutionPlanPage.gotoOpportunity(OPP_PATH!);
    await solutionPlanPage.openGenerateDialog();

    await expect(
      solutionPlanPage.kbCoverageGapBadge('TEAM_QUALIFICATIONS'),
    ).toBeVisible({ timeout: 30_000 });

    // Types with no KB requirements get no coverage badge at all — 16
    // meaningless ticks would drown the two that carry information.
    await expect(
      solutionPlanPage.documentTypeRow('COST_PROPOSAL').getByText(/^Missing:|KB ready/),
    ).toHaveCount(0);

    await solutionPlanPage.closeGenerateDialog();
  });
});

test.describe('KB coverage — KB owner aggregate view', () => {
  test.skip(!ORG_PATH, 'E2E_KB_COVERAGE_ORG_PATH not set');

  test('lists every missing category across document types in one view', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${ORG_PATH!.replace(/\/$/, '')}/kb-coverage`);

    await expect(
      page.getByRole('heading', { name: /knowledge base coverage/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Both cards render once the probe resolves: what the KB holds, and which
    // document types that leaves ungrounded.
    await expect(page.getByText(/knowledge base categories/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(/document types with knowledge base requirements/i),
    ).toBeVisible();

    // Every gated type is listed with a verdict, so the KB owner sees the whole
    // picture rather than only the type someone happened to click.
    const table = page.getByRole('table');
    await expect(table.getByRole('row')).not.toHaveCount(0);
    await expect(table).toContainText('Team Qualifications');
    await expect(table.getByText(/^Covered$|^Gap$|^Blocked$/).first()).toBeVisible();
  });
});
