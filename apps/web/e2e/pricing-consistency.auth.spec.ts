import { test, expect } from './fixtures/auth';
import {
  extractEditorTables,
  extractEditorText,
  extractServicePrices,
  findSourceColumnHeaders,
  findThirdPartyTables,
  findTotalMismatches,
  type ExtractedTable,
} from './helpers/pricing-tables';

/**
 * Pricing-consistency e2e (docs/PRICING-CONSISTENCY-IMPLEMENTATION.md §13) —
 * runs against a REAL environment (deployed dev backend + this branch's
 * frontend), no mocked backend:
 *
 *   PLAYWRIGHT_BASE_URL=...            frontend under test
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD real Cognito login
 *   E2E_SP_PRICING_OPP_PATH            opportunity whose Solution Plan is
 *                                      READY with a priced
 *                                      "Selected Services & Licenses" table
 *                                      (Fixes A + B) — do NOT reuse the
 *                                      solution-plan spec's happy-path
 *                                      opportunity in the same run; both
 *                                      specs generate documents and would
 *                                      race. Pre-existing generated documents
 *                                      are fine — the test tracks its own two
 *                                      documents by the ids in the 202
 *                                      responses
 *
 * Paths look like /organizations/{orgId}/projects/{projectId}/opportunities/{oppId}.
 * The block auto-skips when its env var is unset, mirroring the other specs.
 * The org must have `enableSolutionPlan` on.
 *
 * Intentional non-cleanup: the pricing test leaves one Cost Proposal and one
 * Price Volume per run on the pricing opportunity (no plan-delete API, and
 * the artifacts make runs inspectable on dev); prune occasionally.
 */

const PRICING_OPP_PATH = process.env.E2E_SP_PRICING_OPP_PATH;

/** Ceiling for the async generation worker per queued document. */
const DOCUMENT_GENERATED_TIMEOUT_MS = 10 * 60_000;

test.describe('Pricing consistency — plan as price source + verified totals (Fixes A + B)', () => {
  test.skip(!PRICING_OPP_PATH, 'E2E_SP_PRICING_OPP_PATH not set');

  test('Cost Proposal and Price Volume agree with each other and their own totals', async ({
    page,
    solutionPlanPage,
  }) => {
    test.setTimeout(2 * DOCUMENT_GENERATED_TIMEOUT_MS + 10 * 60_000);
    await solutionPlanPage.gotoOpportunity(PRICING_OPP_PATH!);

    // Precondition on dev data: READY plan.
    await expect(
      solutionPlanPage.statusBadge(/^ready$/i).first(),
      'no READY plan on the pricing opportunity — repoint E2E_SP_PRICING_OPP_PATH',
    ).toBeVisible({ timeout: 30_000 });

    // Queue BOTH pricing documents from one dialog so they share the same
    // plan version.
    await solutionPlanPage.openGenerateDialog();
    await expect(solutionPlanPage.gateCallout).not.toBeVisible();
    const costProposalCheckbox = solutionPlanPage.documentTypeCheckbox('COST_PROPOSAL');
    const priceVolumeCheckbox = solutionPlanPage.documentTypeCheckbox('PRICE_VOLUME');
    await expect(costProposalCheckbox).toBeEnabled({ timeout: 15_000 });
    await costProposalCheckbox.check();
    await priceVolumeCheckbox.check();

    // The dialog POSTs /generate-document once per selected type; collect the
    // 202 bodies so THIS run's documents can be opened by id (document names
    // are not unique across runs).
    const queuedDocuments: Array<{ documentType: string; documentId: string }> = [];
    page.on('response', (res) => {
      if (
        res.url().includes('/generate-document') &&
        res.request().method() === 'POST' &&
        res.status() === 202
      ) {
        void res
          .json()
          .then((body: { documentType: string; documentId: string }) =>
            queuedDocuments.push(body),
          )
          .catch(() => undefined);
      }
    });
    await solutionPlanPage.generateDialog
      .getByRole('button', { name: /generate \(\d+\)/i })
      .click();
    await expect
      .poll(() => queuedDocuments.length, {
        message: 'both generate-document requests must be accepted with 202',
        timeout: 60_000,
      })
      .toBe(2);

    // Both async workers must finish (not just queue).
    await solutionPlanPage.waitForDocumentGenerated(
      'Cost Proposal',
      DOCUMENT_GENERATED_TIMEOUT_MS,
    );
    await solutionPlanPage.waitForDocumentGenerated(
      'Price Volume',
      DOCUMENT_GENERATED_TIMEOUT_MS,
    );

    // Read each generated document's rendered tables from the editor.
    const documentsUnderTest = [
      { label: 'Cost Proposal', documentType: 'COST_PROPOSAL' },
      { label: 'Price Volume', documentType: 'PRICE_VOLUME' },
    ] as const;
    const tablesByDocument = new Map<string, ExtractedTable[]>();

    for (const { label, documentType } of documentsUnderTest) {
      const queued = queuedDocuments.find((d) => d.documentType === documentType);
      expect(queued, `${label}: no 202 captured for ${documentType}`).toBeTruthy();
      const editorContent = await solutionPlanPage.gotoDocumentEditor(
        PRICING_OPP_PATH!,
        queued!.documentId,
      );
      const tables = await extractEditorTables(editorContent);
      expect(tables.length, `${label}: no tables rendered`).toBeGreaterThan(0);
      tablesByDocument.set(label, tables);

      // Fix A — no price provenance in customer-facing documents: no Source
      // column, no retrieval dates, no sources footnote.
      expect(
        findSourceColumnHeaders(tables),
        `${label}: pricing tables must not carry a Source column`,
      ).toEqual([]);
      const bodyText = await extractEditorText(editorContent);
      expect(bodyText).not.toMatch(/retriev(?:ed|al)/i);
      expect(bodyText).not.toMatch(/third-party pricing sources/i);

      // Fix B — every stated table total matches the recomputed sum.
      expect(
        findTotalMismatches(tables),
        `${label}: stated totals must match recomputed sums`,
      ).toEqual([]);
    }

    // Fix A — both documents copy the SAME plan rows: services priced in both
    // documents must carry identical prices.
    const [costTables, priceTables] = documentsUnderTest.map(
      ({ label }) => tablesByDocument.get(label)!,
    );
    const costThirdParty = findThirdPartyTables(costTables);
    const priceThirdParty = findThirdPartyTables(priceTables);
    expect(costThirdParty.length, 'Cost Proposal: third-party table missing').toBeGreaterThan(0);
    expect(priceThirdParty.length, 'Price Volume: third-party table missing').toBeGreaterThan(0);

    const costServices = extractServicePrices(costThirdParty);
    const priceServices = extractServicePrices(priceThirdParty);
    const sharedServices = [...costServices.keys()].filter((name) =>
      priceServices.has(name),
    );
    expect(
      sharedServices.length,
      'documents share no third-party services — rows were not copied from the plan',
    ).toBeGreaterThan(0);

    for (const service of sharedServices) {
      const costPrices = [...costServices.get(service)!].sort((a, b) => a - b);
      const pricePrices = [...priceServices.get(service)!].sort((a, b) => a - b);
      expect(
        pricePrices,
        `service "${service}" priced differently across documents`,
      ).toEqual(costPrices);
    }
  });
});
