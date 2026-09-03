import { type Locator, type Page, type Response, expect } from '@playwright/test';
import type { OpportunityItem } from '@auto-rfp/core';

/**
 * Page object for the Physical Submission Detection feature:
 * - warning banner on the opportunity detail page
 *   (OpportunityView Compliance details tab, `#tabpanel-compliance` →
 *   `PhysicalSubmissionBanner`)
 * - "Physical Mail" chip (`PhysicalSubmissionChip`) reused on opportunity
 *   list cards and RFP-tracking pipeline cards
 *
 * Opportunity paths look like:
 * /organizations/{orgId}/projects/{projectId}/opportunities/{oppId}
 */
export class PhysicalSubmissionPage {
  /** Body of the most recent `GET .../opportunity/get-opportunity` response seen on the wire. */
  private latestOpportunity: OpportunityItem | null = null;

  constructor(private readonly page: Page) {}

  /** The Compliance details tab body (`#tabpanel-compliance`) from OpportunityView. */
  get section(): Locator {
    return this.page.locator('#tabpanel-compliance');
  }

  get banner(): Locator {
    return this.page.getByTestId('physical-submission-banner');
  }

  get address(): Locator {
    return this.page.getByTestId('physical-submission-address');
  }

  get deadline(): Locator {
    return this.page.getByTestId('physical-submission-deadline');
  }

  get toggle(): Locator {
    return this.page.getByRole('switch', { name: 'Requires physical submission' });
  }

  /** The "Physical Mail" chip, scoped to a card/section when one is given. */
  chip(scope: Locator | Page = this.page): Locator {
    return scope.getByTestId('physical-submission-chip');
  }

  private async waitForOpportunityResponse(action: () => Promise<void>): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/opportunity/get-opportunity') && res.request().method() === 'GET',
        { timeout: 30_000 },
      ),
      action(),
    ]);
    this.latestOpportunity = (await response.json().catch(() => null)) as OpportunityItem | null;
    return response;
  }

  /** Navigate to an opportunity detail page (Compliance details tab) and wait for
   *  it to render. The banner now lives in a lazily-mounted tab body, so deep-link
   *  straight to `?tab=compliance` to mount + reveal it. */
  async gotoOpportunity(opportunityPath: string): Promise<void> {
    const url = opportunityPath.includes('?')
      ? `${opportunityPath}&tab=compliance`
      : `${opportunityPath}?tab=compliance`;
    await this.waitForOpportunityResponse(() => this.page.goto(url).then(() => undefined));
    await expect(this.section).toBeVisible({ timeout: 30_000 });
  }

  /** The opportunity payload captured from the last `get-opportunity` response. */
  getLatestOpportunity(): OpportunityItem | null {
    return this.latestOpportunity;
  }

  /** Parse `/organizations/{orgId}/projects/{projectId}/opportunities/{oppId}` into its parts. */
  static parseOpportunityPath(opportunityPath: string): { orgId: string; projectId: string; oppId: string } {
    const match = opportunityPath.match(
      /^\/organizations\/([^/]+)\/projects\/([^/]+)\/opportunities\/([^/]+)/,
    );
    if (!match) {
      throw new Error(`Unexpected opportunity path: ${opportunityPath}`);
    }
    const [, orgId, projectId, oppId] = match;
    return { orgId, projectId, oppId };
  }

  /** Derive the project's opportunities list path from a detail-page opportunity path. */
  static listPathFor(opportunityPath: string): string {
    const match = opportunityPath.match(/^(\/organizations\/[^/]+\/projects\/[^/]+)\/opportunities\/[^/]+/);
    if (!match) {
      throw new Error(`Unexpected opportunity path, cannot derive list path: ${opportunityPath}`);
    }
    return `${match[1]}/opportunities`;
  }

  async gotoList(opportunityPath: string): Promise<void> {
    await this.page.goto(PhysicalSubmissionPage.listPathFor(opportunityPath));
    await expect(this.page.getByTestId('opportunity-card').first()).toBeVisible({ timeout: 30_000 });
  }

  /** The list card whose title matches the given opportunity title. */
  cardWithTitle(title: string): Locator {
    return this.page.getByTestId('opportunity-card').filter({ hasText: title });
  }

  /**
   * Toggle the banner's switch and wait for the resulting
   * `PUT .../opportunity/update-opportunity` request to settle.
   */
  async toggleAndWaitForUpdate(): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/opportunity/update-opportunity') && res.request().method() === 'PUT',
        { timeout: 15_000 },
      ),
      this.toggle.click(),
    ]);
    return response;
  }
}
