import { test, expect } from './fixtures/auth';
import {
  ISSUE_TYPE_PRETTY,
  NEW_CHECK_ISSUE_TYPES,
} from './pages/compliance-review.page';
import type { ComplianceFinding } from '@auto-rfp/core';

/**
 * AI Compliance Review e2e — runs against a REAL environment (deployed dev
 * backend + this branch's frontend), no mocked backend:
 *
 *   PLAYWRIGHT_BASE_URL=...            frontend under test
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD real Cognito login (or reuse the
 *                                      SSO storage state — the auth fixture
 *                                      auto-skips when E2E_TEST_EMAIL is unset)
 *   E2E_COMPLIANCE_OPP_PATH            an opportunity with a submission package
 *                                      (RFP documents + required forms) and,
 *                                      ideally, a READY solution plan + KB +
 *                                      past-performance records so the new
 *                                      factual/consistency checks (C1–C6) have
 *                                      something to fire on. The org must have
 *                                      `complianceReviewEnabled` on.
 *
 * Opportunity paths look like:
 *   /organizations/090a7613-c237-4c39-8bc9-0423ae48b760/projects/{projectId}/opportunities/{oppId}
 *
 * The whole-package review is AI-driven, so its findings are non-deterministic:
 * this spec asserts on STRUCTURE and INVARIANTS (well-formedness of every
 * finding, that the new-check issue types are recognised end-to-end, that the
 * UI surfaces / filters / triage actions work), never on a specific model
 * output. A real review makes many model calls over an SQS worker, so timeouts
 * are minutes, not seconds.
 *
 * Intentional non-cleanup: each run appends one review run (latest-run
 * authoritative; older runs are TTL-pruned by RUN_KEEP_COUNT / RUN_TTL_DAYS).
 * Any decision toggled during triage is toggled back before the test ends.
 */

const OPP_PATH = process.env.E2E_COMPLIANCE_OPP_PATH;

/** Ceiling for a full whole-package review (many model calls over SQS). */
const REVIEW_TERMINAL_TIMEOUT_MS = 20 * 60_000;

/** Every issue type the panel can render (for well-formedness assertions). */
const ALL_ISSUE_TYPES: ComplianceFinding['issueType'][] = [
  'MISSING_REQUIREMENT',
  'MISSING_FORM',
  'INCORRECT_ANSWER',
  'POOR_ANSWER',
  'FORMAT_ISSUE',
  'INCONSISTENCY',
  'FACTUAL_INACCURACY',
  'UNVERIFIED_CLAIM',
  'NDA_DISCLOSURE_LEAK',
  'SOLUTION_PLAN_MISMATCH',
  'OTHER',
];

const SEVERITIES: ComplianceFinding['severity'][] = ['critical', 'major', 'minor', 'info'];

test.describe('AI Compliance Review — full package review (real backend)', () => {
  test.skip(!OPP_PATH, 'E2E_COMPLIANCE_OPP_PATH not set');

  test('runs a whole-package review and surfaces well-formed findings across all checks', async ({
    complianceReviewPage,
  }) => {
    test.setTimeout(REVIEW_TERMINAL_TIMEOUT_MS + 5 * 60_000);

    await complianceReviewPage.gotoOpportunity(OPP_PATH!);

    // The panel starts on the Full Review tab.
    await expect(complianceReviewPage.fullReviewTab).toBeVisible();
    await expect(complianceReviewPage.runButton).toBeVisible({ timeout: 30_000 });

    // Reuse a fresh READY run if one exists, else trigger + wait (the backend
    // allows only one running review per opportunity — see ensureReviewReady).
    const run = await complianceReviewPage.ensureReviewReady(REVIEW_TERMINAL_TIMEOUT_MS);

    // The run reached READY with a coherent shape.
    expect(run.run?.status).toBe('READY');
    expect(run.run?.trigger).toBe('FULL');
    const findings = run.run?.findings ?? [];

    // ── Every finding is well-formed (schema-shape invariants) ────────────────
    for (const f of findings) {
      expect(f.findingId, 'finding must carry an id').toBeTruthy();
      expect(f.fingerprint, 'finding must carry a stable fingerprint').toBeTruthy();
      expect(f.title, 'finding must have a title').toBeTruthy();
      expect(ALL_ISSUE_TYPES).toContain(f.issueType);
      expect(SEVERITIES).toContain(f.severity);
      expect(
        [
          'RFP_DOCUMENT',
          'XLSX_QUESTIONNAIRE',
          'XLSX_FORM',
          'PDF_FORM',
          'FORM_MISSING',
        ],
        `unexpected targetKind on finding "${f.title}"`,
      ).toContain(f.targetKind);
      // Only a missing form legitimately has no document to open.
      if (f.targetKind !== 'FORM_MISSING') {
        expect(f.documentId, `non-missing finding "${f.title}" must reference a document`).toBeTruthy();
      }
      // Fingerprints are the decision identity — they must be stable-looking strings.
      expect(f.fingerprint.length).toBeGreaterThan(0);
    }

    // ── The captured payload and the rendered UI agree ───────────────────────
    if (findings.length === 0) {
      // A genuinely clean package: the empty state, not a broken render.
      await expect(complianceReviewPage.emptyFindings).toBeVisible();
      test.info().annotations.push({
        type: 'note',
        description:
          'Review returned zero findings — point E2E_COMPLIANCE_OPP_PATH at a package with known issues to exercise the finding surfaces.',
      });
      return;
    }

    // The stats hero counts the ACTIVE findings (none decided yet on a fresh run).
    await expect(complianceReviewPage.statsHero).toBeVisible();
    const heroText = (await complianceReviewPage.statsHero.textContent()) ?? '';
    const heroCount = Number(heroText.match(/\d+/)?.[0] ?? '0');
    expect(heroCount).toBe(findings.length);

    // One card per finding is rendered.
    await expect(complianceReviewPage.findingCards).toHaveCount(findings.length);
  });
});

test.describe('AI Compliance Review — new factual & consistency checks (C1–C6)', () => {
  test.skip(!OPP_PATH, 'E2E_COMPLIANCE_OPP_PATH not set');

  test('recognises company-facts, KB, past-performance, solution-plan, pricing & team findings end-to-end', async ({
    complianceReviewPage,
  }) => {
    test.setTimeout(REVIEW_TERMINAL_TIMEOUT_MS + 5 * 60_000);

    await complianceReviewPage.gotoOpportunity(OPP_PATH!);

    // Reuse the latest READY run if present, else trigger a fresh one.
    const run = await complianceReviewPage.ensureReviewReady(REVIEW_TERMINAL_TIMEOUT_MS);
    expect(run.run?.status).toBe('READY');

    const byIssue = complianceReviewPage.findingsByIssueType();
    const newCheckCounts = NEW_CHECK_ISSUE_TYPES.map((t) => ({
      issueType: t,
      count: byIssue.get(t)?.length ?? 0,
    }));

    // Surface the distribution in the report + console — useful when repointing
    // the env var and for confirming which of C1–C6 fired on this package.
    test.info().annotations.push({
      type: 'new-check-findings',
      description: JSON.stringify(newCheckCounts),
    });
    const total = run.run?.findings?.length ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `\n[compliance-review] ${total} total findings; new-check distribution:\n` +
        newCheckCounts.map((c) => `    ${c.issueType}: ${c.count}`).join('\n'),
    );

    // Every new-check finding that DID fire must be well-formed and match its
    // check's contract. We don't require all six to fire (that depends on the
    // package data), but the ones present must be correct — this is the
    // end-to-end proof that C1–C6 wire through to the UI.
    for (const { issueType } of newCheckCounts) {
      const list = byIssue.get(issueType) ?? [];
      for (const f of list) {
        expect(f.issueType).toBe(issueType);
        expect(f.title, `${issueType} finding must have a title`).toBeTruthy();
        expect(f.description, `${issueType} finding must have a description`).toBeDefined();
        // Factual / consistency findings should cite either a package spot
        // (documentId + snippet/anchor) or, for plan mismatches, name the
        // conflicting values in the description.
        if (issueType !== 'SOLUTION_PLAN_MISMATCH') {
          expect(
            f.documentId || f.snippet,
            `${issueType} finding "${f.title}" must localize to a package spot`,
          ).toBeTruthy();
        }
      }
    }

    // If any new-check finding fired, exercise its UI surface: filter to that
    // issue type and confirm the cards render with the pretty label + severity.
    const firstPresent = newCheckCounts.find((c) => c.count > 0);
    if (!firstPresent) {
      test.info().annotations.push({
        type: 'note',
        description:
          'No C1–C6 findings on this package. Repoint E2E_COMPLIANCE_OPP_PATH at an opportunity with a stale company fact, an unverifiable cert, a KB contradiction, an NDA-restricted client name, a READY solution plan whose prices/team differ from the package, or a past-performance mismatch to exercise these surfaces.',
      });
      return;
    }

    const pretty = ISSUE_TYPE_PRETTY[firstPresent.issueType];
    await complianceReviewPage.filterByIssueType(pretty);
    // Filtered cards all carry the pretty issue-type badge.
    const filteredCards = complianceReviewPage.findingCards;
    await expect(filteredCards.first()).toBeVisible();
    const filteredCount = await filteredCards.count();
    expect(filteredCount).toBe(firstPresent.count);
    // The issue-type badge text is present on the filtered cards.
    await expect(complianceReviewPage.panel.getByText(pretty).first()).toBeVisible();

    await complianceReviewPage.clearIssueTypeFilter();
  });
});

test.describe('AI Compliance Review — triage actions (resolve / reopen)', () => {
  test.skip(!OPP_PATH, 'E2E_COMPLIANCE_OPP_PATH not set');

  test('a finding can be resolved and reopened, persisting by fingerprint', async ({
    page,
    complianceReviewPage,
  }) => {
    test.setTimeout(REVIEW_TERMINAL_TIMEOUT_MS + 5 * 60_000);

    await complianceReviewPage.gotoOpportunity(OPP_PATH!);
    const run = await complianceReviewPage.ensureReviewReady(REVIEW_TERMINAL_TIMEOUT_MS);

    const findings = run.run?.findings ?? [];
    test.skip(findings.length === 0, 'no findings to triage on this package');

    const totalBefore = findings.length;
    const firstCard = complianceReviewPage.findingCards.first();
    await expect(firstCard).toBeVisible();

    // Resolve the first active finding — it must post a decision and leave the
    // active list (dropping into the collapsible "Resolved (n)" group).
    const [decisionResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('compliance-review/decision') &&
          res.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      firstCard.getByRole('button', { name: /^resolve$/i }).click(),
    ]);
    expect(decisionResponse.status(), 'resolve decision must be accepted').toBe(200);

    // Active count drops by one; the Resolved group appears.
    await expect(complianceReviewPage.findingCards).toHaveCount(totalBefore - 1);
    await expect(complianceReviewPage.resolvedGroup(1)).toBeVisible({ timeout: 15_000 });

    // The decision survives a reload (persisted by fingerprint).
    await page.reload();
    await expect(complianceReviewPage.panel).toBeVisible({ timeout: 30_000 });
    await complianceReviewPage.fullReviewTab.click();
    await expect(complianceReviewPage.resolvedGroup(1)).toBeVisible({ timeout: 30_000 });

    // Reopen it (clean up) — expand the Resolved group, click Reopen, count restores.
    await complianceReviewPage.resolvedGroup(1).click();
    const [reopenResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('compliance-review/decision') &&
          res.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      complianceReviewPage.panel.getByRole('button', { name: /^reopen$/i }).first().click(),
    ]);
    expect(reopenResponse.status(), 'reopen decision must be accepted').toBe(200);
    await expect(complianceReviewPage.findingCards).toHaveCount(totalBefore, { timeout: 15_000 });
  });
});

test.describe('AI Compliance Review — chat (targeted questions)', () => {
  test.skip(!OPP_PATH, 'E2E_COMPLIANCE_OPP_PATH not set');

  test('answers a targeted question about the package synchronously', async ({
    complianceReviewPage,
  }) => {
    test.setTimeout(3 * 60_000);

    await complianceReviewPage.gotoOpportunity(OPP_PATH!);
    await complianceReviewPage.chatTab.click();

    // The empty chat offers starter prompts; sending one drives the synchronous
    // chat endpoint (fast model, bounded tool rounds) and returns an answer.
    const answer = await complianceReviewPage.sendChatMessage(
      'Is the company name consistent across all documents?',
    );
    expect(answer.trim().length, 'chat must return a non-empty answer').toBeGreaterThan(0);

    // The persisted transcript renders the just-sent user message. The panel's
    // active tab is local state that can reset to Full Review on the post-send
    // re-render, so re-select Chat before asserting (history is server-persisted).
    await complianceReviewPage.chatTab.click();
    // Persisted history can carry this question more than once across re-runs,
    // so assert at least one echo is visible rather than a unique match.
    await expect(
      complianceReviewPage.chatMessage(/is the company name consistent/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
