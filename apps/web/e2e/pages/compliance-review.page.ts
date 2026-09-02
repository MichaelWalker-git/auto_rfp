import { type Locator, type Page, expect } from '@playwright/test';
import type {
  ComplianceFinding,
  ComplianceIssueType,
  GetReviewResponse,
} from '@auto-rfp/core';

/**
 * Page object for the AI Compliance Review panel mounted on the opportunity page
 * (OpportunityView `<section id="ai-compliance-review">`, gated behind the
 * single-org `complianceReviewEnabled` flag).
 *
 * Opportunity paths look like:
 * /organizations/{orgId}/projects/{projectId}/opportunities/{oppId}
 *
 * The full review is AI-driven against a real package, so its findings are
 * non-deterministic — this object exposes both UI locators AND a network capture
 * of the latest `GET compliance-review/run` payload, so a spec can assert on the
 * structured findings (issue-type distribution, well-formedness) without
 * depending on a specific model output.
 */

/** Issue types produced by the new factual-accuracy / consistency checks (C1–C6). */
export const NEW_CHECK_ISSUE_TYPES = [
  'FACTUAL_INACCURACY', // C1 company facts, C3 KB contradiction, C4 past-performance
  'UNVERIFIED_CLAIM', // C2 certifications
  'NDA_DISCLOSURE_LEAK', // C5 client-name leak
  'SOLUTION_PLAN_MISMATCH', // C6 solution-plan / pricing / team consistency
] as const satisfies readonly ComplianceIssueType[];

/** Human-readable labels the UI renders for each new-check issue type. */
export const ISSUE_TYPE_PRETTY: Record<string, RegExp> = {
  FACTUAL_INACCURACY: /factual inaccuracy/i,
  UNVERIFIED_CLAIM: /unverified claim/i,
  NDA_DISCLOSURE_LEAK: /nda disclosure leak/i,
  SOLUTION_PLAN_MISMATCH: /solution plan mismatch/i,
};

export class ComplianceReviewPage {
  /** Latest `GET compliance-review/run` body seen on the wire (null until first poll). */
  private latestRun: GetReviewResponse | null = null;
  private capturing = false;

  constructor(private readonly page: Page) {}

  /** The gated `<section id="ai-compliance-review">` mount from OpportunityView. */
  get panel(): Locator {
    return this.page.locator('section#ai-compliance-review');
  }

  get fullReviewTab(): Locator {
    return this.panel.getByRole('tab', { name: /full review/i });
  }

  get chatTab(): Locator {
    return this.panel.getByRole('tab', { name: /chat/i });
  }

  /** The run button toggles label: "Run full review" → "Reviewing…" → "Re-run review". */
  get runButton(): Locator {
    return this.panel.getByRole('button', {
      name: /run full review|re-run review|reviewing/i,
    });
  }

  get runningBanner(): Locator {
    return this.panel.getByText(/reviewing the whole package against the solicitation/i);
  }

  get failedAlert(): Locator {
    return this.panel.getByText(/the last review failed/i);
  }

  get staleAlert(): Locator {
    return this.panel.getByText(/the package changed since this review ran/i);
  }

  get emptyFindings(): Locator {
    return this.panel.getByText(/no compliance issues found in this review/i);
  }

  /** Every finding card wrapper carries `data-fp={fingerprint}`. */
  get findingCards(): Locator {
    return this.panel.locator('[data-fp]');
  }

  /**
   * The focal summary hero. The count and the word "findings" render in
   * SEPARATE spans, so match the numeric span itself — it's the large tabular
   * count that leads the FindingsStats banner. Scoped to the banner (rounded
   * border container) so it doesn't collide with per-card numbers.
   */
  get statsHero(): Locator {
    return this.panel.getByText(/^\d+$/).first();
  }

  /** Filter-bar comboboxes (severity / issue type / document). */
  get severityFilter(): Locator {
    return this.panel.getByRole('combobox').nth(0);
  }
  get issueTypeFilter(): Locator {
    return this.panel.getByRole('combobox').nth(1);
  }
  get documentFilter(): Locator {
    return this.panel.getByRole('combobox').nth(2);
  }

  resolvedGroup(count?: number): Locator {
    return this.panel.getByText(count === undefined ? /^Resolved \(\d+\)$/ : new RegExp(`^Resolved \\(${count}\\)$`));
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  get chatInput(): Locator {
    return this.panel.getByPlaceholder(/ask about the package/i);
  }

  /** Assistant bubbles render after each turn; user echoes render on the right. */
  chatMessage(text: RegExp): Locator {
    return this.panel.getByText(text);
  }

  // ── Navigation & capture ────────────────────────────────────────────────────

  /**
   * Start capturing the latest `GET compliance-review/run` response body. Call
   * BEFORE navigating so the initial poll is captured too. Idempotent.
   */
  startCapturingRuns(): void {
    if (this.capturing) return;
    this.capturing = true;
    this.page.on('response', (res) => {
      const url = res.url();
      if (
        url.includes('compliance-review/run') &&
        res.request().method() === 'GET' &&
        res.status() === 200
      ) {
        void res
          .json()
          .then((body: GetReviewResponse) => {
            this.latestRun = body;
          })
          .catch(() => undefined);
      }
    });
  }

  getLatestRun(): GetReviewResponse | null {
    return this.latestRun;
  }

  async gotoOpportunity(opportunityPath: string): Promise<void> {
    this.startCapturingRuns();
    await this.page.goto(opportunityPath);
    // Fail loudly if the single-org flag is off — the panel simply won't mount.
    await expect(
      this.panel,
      'AI Compliance Review panel not mounted — the org must have complianceReviewEnabled on, and the path must point at an opportunity',
    ).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Wait for the first GET /run poll to land so `latestRun` reflects real state
   * before we decide whether to reuse or trigger.
   */
  private async waitForFirstRunPoll(): Promise<void> {
    await expect
      .poll(() => (this.latestRun !== null ? 'seen' : 'pending'), {
        message: 'never observed a GET compliance-review/run response',
        timeout: 30_000,
        intervals: [500],
      })
      .toBe('seen');
  }

  /**
   * Get the opportunity to a terminal READY review, cheaply. The backend allows
   * only ONE running review per opportunity (409 otherwise), and a full review
   * costs minutes, so tests REUSE an existing fresh run instead of always
   * re-triggering:
   *   - latest run READY and not stale → reuse it as-is.
   *   - a run already RUNNING          → just wait for it to finish.
   *   - otherwise (none / FAILED / stale) → trigger a fresh one, then wait.
   * Fails fast with the backend error if the run lands on FAILED.
   */
  async ensureReviewReady(timeoutMs: number): Promise<GetReviewResponse> {
    await this.fullReviewTab.click();
    await this.waitForFirstRunPoll();

    const current = this.latestRun;
    const status = current?.run?.status ?? null;
    const stale = current?.stale ?? false;

    if (status === 'READY' && !stale) {
      // Reuse: the panel already renders this run's findings.
      await expect(this.statsHero.or(this.emptyFindings).first()).toBeVisible({ timeout: 30_000 });
      return current!;
    }

    if (status !== 'RUNNING') {
      // No usable run — trigger a fresh one and confirm it's accepted.
      const [triggerResponse] = await Promise.all([
        this.page.waitForResponse(
          (res) =>
            res.url().includes('compliance-review/run') &&
            res.request().method() === 'POST',
          { timeout: 60_000 },
        ),
        this.runButton.click(),
      ]);
      expect(
        [200, 202].includes(triggerResponse.status()),
        `trigger review must be accepted (got ${triggerResponse.status()})`,
      ).toBeTruthy();
    }

    return this.waitForRunTerminal(timeoutMs);
  }

  /**
   * Poll (via the panel's own 5s SWR refresh) until the captured run reaches a
   * terminal status. Fails fast with the backend error if it lands on FAILED.
   * A whole-package AI review makes many model calls, so the ceiling is minutes.
   */
  async waitForRunTerminal(timeoutMs: number): Promise<GetReviewResponse> {
    await expect
      .poll(() => this.latestRun?.run?.status ?? 'RUNNING', {
        message: 'full review never reached a terminal status',
        timeout: timeoutMs,
        intervals: [5_000],
      })
      .not.toBe('RUNNING');

    const run = this.latestRun;
    if (run?.run?.status === 'FAILED') {
      throw new Error(`Compliance review FAILED on the backend: ${run.run.error ?? 'no error detail'}`);
    }
    // UI reflects the terminal state: either the stats hero, or the empty state.
    await expect(this.statsHero.or(this.emptyFindings).first()).toBeVisible({ timeout: 30_000 });
    return run!;
  }

  /** Group the captured run's findings by issue type. */
  findingsByIssueType(): Map<ComplianceIssueType, ComplianceFinding[]> {
    const map = new Map<ComplianceIssueType, ComplianceFinding[]>();
    for (const f of this.latestRun?.run?.findings ?? []) {
      const list = map.get(f.issueType) ?? [];
      list.push(f);
      map.set(f.issueType, list);
    }
    return map;
  }

  /**
   * Select an issue type in the filter combobox by its pretty label, then return
   * the resulting card locator set. Radix Select renders options in a portal.
   */
  async filterByIssueType(pretty: RegExp): Promise<void> {
    await this.issueTypeFilter.click();
    await this.page.getByRole('option', { name: pretty }).click();
  }

  async clearIssueTypeFilter(): Promise<void> {
    await this.issueTypeFilter.click();
    await this.page.getByRole('option', { name: /all issue types/i }).click();
  }

  /**
   * Send a chat message and wait for the synchronous assistant reply. The
   * unified chat routes by permission: editors (proposal:edit) hit
   * `package-edit/chat`, read-only users hit `compliance-review/chat`. Both
   * return an `answer`, so accept either endpoint.
   */
  async sendChatMessage(message: string): Promise<string> {
    await this.chatTab.click();
    await this.chatInput.fill(message);
    const [chatResponse] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          /(?:compliance-review|package-edit)\/chat/.test(res.url()) &&
          res.request().method() === 'POST',
        { timeout: 90_000 },
      ),
      this.chatInput.press('Enter'),
    ]);
    expect(chatResponse.status(), 'chat request must succeed').toBe(200);
    const body: { answer: string } = await chatResponse.json();
    return body.answer;
  }
}
