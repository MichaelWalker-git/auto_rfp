import { type Locator, type Page, expect } from '@playwright/test';

/**
 * Page object for the Solution Plan panel on the opportunity page and the
 * Solution-Plan-gated "Generate Documents" dialog (T10/T12).
 *
 * Opportunity paths look like:
 * /organizations/{orgId}/projects/{projectId}/opportunities/{oppId}
 */
/** Doc-type keys the tests interact with (checkbox ids are `gen-${key}`). */
export type GateTestDocumentType =
  | 'TECHNICAL_PROPOSAL'
  | 'COST_PROPOSAL'
  | 'CLARIFYING_QUESTIONS';

export class SolutionPlanPage {
  constructor(private readonly page: Page) {}

  // The opportunity page's sections have no headings — their Card titles are
  // plain divs — so the stable `<section id>` landmarks from OpportunityView
  // are the most honest anchors available (documented selector deviation).

  /** The `<section id="solution-plan">` mount from OpportunityView. */
  get panel(): Locator {
    return this.page.locator('section#solution-plan');
  }

  get rfpDocumentsSection(): Locator {
    return this.page.locator('section#rfp-documents');
  }

  get startButton(): Locator {
    return this.panel.getByRole('button', { name: /start solution plan/i });
  }

  get regenerateButton(): Locator {
    return this.panel.getByRole('button', { name: /regenerate/i });
  }

  get retryButton(): Locator {
    return this.panel.getByRole('button', { name: /^retry$/i });
  }

  get viewAndEditLink(): Locator {
    return this.panel.getByRole('link', { name: /view & edit/i });
  }

  statusBadge(label: RegExp): Locator {
    return this.panel.getByText(label);
  }

  /** Griller messages render with an "Interviewer" author label. */
  get interviewerMessages(): Locator {
    return this.panel.getByText('Interviewer', { exact: true });
  }

  get generateDialogTrigger(): Locator {
    return this.rfpDocumentsSection.getByRole('button', { name: /^generate$/i });
  }

  get generateDialog(): Locator {
    return this.page.getByRole('dialog', { name: /generate documents/i });
  }

  get gateCallout(): Locator {
    return this.generateDialog.getByTestId('solution-plan-gate-callout');
  }

  get nudgeBanner(): Locator {
    return this.generateDialog.getByTestId('solution-plan-nudge-banner');
  }

  async gotoOpportunity(opportunityPath: string): Promise<void> {
    await this.page.goto(opportunityPath);
    await expect(this.panel).toBeVisible({ timeout: 30_000 });
  }

  async openGenerateDialog(): Promise<void> {
    await this.generateDialogTrigger.scrollIntoViewIfNeeded();
    await this.generateDialogTrigger.click();
    await expect(this.generateDialog).toBeVisible();
  }

  async closeGenerateDialog(): Promise<void> {
    await this.generateDialog.getByRole('button', { name: /cancel/i }).click();
    await expect(this.generateDialog).not.toBeVisible();
  }

  /**
   * Checkbox for a document-type row inside the generate dialog. Selected by
   * the `gen-${key}` id rather than the visible label: labels are display
   * text that org-level custom document types can duplicate, while the id is
   * derived from the domain key.
   */
  documentTypeCheckbox(documentTypeKey: GateTestDocumentType): Locator {
    return this.generateDialog.locator(`#gen-${documentTypeKey}`);
  }

  /**
   * Start a run regardless of current panel state: fresh plans use
   * "Start Solution Plan", READY plans go through Regenerate + confirm,
   * FAILED plans use Retry. Returns once the run is visibly in flight.
   */
  async startOrRegenerateRun(): Promise<void> {
    // Wait for the plan query to settle — until it does the panel renders a
    // skeleton and none of the action controls exist yet.
    const anyAction = this.startButton.or(this.retryButton).or(this.regenerateButton);
    await expect(anyAction.first()).toBeVisible({ timeout: 30_000 });

    if (await this.startButton.isVisible().catch(() => false)) {
      await this.startButton.click();
    } else if (await this.retryButton.isVisible().catch(() => false)) {
      await this.retryButton.click();
    } else {
      await this.regenerateButton.click();
      const confirmDialog = this.page.getByRole('alertdialog');
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: /regenerate/i }).click();
    }

    await expect(
      this.statusBadge(/interview in progress|generating plan/i).first(),
    ).toBeVisible({ timeout: 60_000 });
  }

  /**
   * Poll (via the panel's own 3s SWR refresh) until the plan reaches READY.
   * A real grilling run makes many model calls, so the ceiling is minutes.
   * Fails fast with a clear message if the run lands on FAILED instead of
   * silently waiting out the full READY timeout.
   */
  async waitForReady(timeoutMs: number): Promise<void> {
    const failedAlert = this.panel.getByText(/solution plan generation failed/i);
    await expect(this.viewAndEditLink.or(failedAlert).first()).toBeVisible({
      timeout: timeoutMs,
    });
    if (await failedAlert.isVisible().catch(() => false)) {
      const alertText = (await failedAlert.textContent()) ?? 'no error detail';
      throw new Error(`Solution Plan run FAILED on the backend: ${alertText}`);
    }
  }

  /**
   * Wait until the async generation worker actually finishes the queued
   * document: the row exists in the RFP Documents section and no
   * generating/retrying/failed badge remains. The list doesn't live-poll,
   * so reload between checks.
   */
  async waitForDocumentGenerated(documentLabel: string, timeoutMs: number): Promise<void> {
    await expect(async () => {
      await this.page.reload();
      await expect(this.rfpDocumentsSection).toBeVisible({ timeout: 30_000 });
      await expect(
        this.rfpDocumentsSection.getByText(documentLabel).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(this.rfpDocumentsSection.getByText(/generating|retrying/i)).toHaveCount(0);
      await expect(this.rfpDocumentsSection.getByText(/❌ failed/i)).toHaveCount(0);
    }).toPass({ timeout: timeoutMs, intervals: [20_000] });
  }
}
