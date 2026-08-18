import {
  FOIA_PRICING_CHART_LIMIT,
  resolveFoiaOutcomeBucket,
  type FoiaDashboardCounts,
  type FoiaDashboardResponse,
  type FoiaOutcomeBucket,
  type FoiaPricingComparison,
  type FoiaResponseOutcome,
  type FoiaScoreComparison,
} from '@auto-rfp/core';
import type { FoiaAutomationDBItem, OpportunityDBItem } from '@auto-rfp/core';

import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { nowIso } from '@/helpers/date';
import { queryAllBySkPrefix } from '@/helpers/db';
import { listFoiaAutomationsByOrg } from '@/helpers/foia-automation';
import { listFoiaRequestsByOrg } from '@/helpers/foia';

/**
 * Aggregates the org-wide FOIA comparison dashboard.
 *
 * Three org-scoped prefix reads, joined in memory on `oppId`. Kept out of the handler
 * so the join is unit-testable without simulating an API event, and kept as one pass
 * so the page costs three queries rather than one per opportunity.
 *
 * Everything here is derived on read. Nothing is persisted, so a change to how a
 * bucket is defined takes effect immediately and cannot leave stale rows behind.
 */

const emptyCounts = (): FoiaDashboardCounts => ({
  WON: 0,
  LOST: 0,
  NOT_PRESENT: 0,
  CANCELLED: 0,
});

/** Sorts most-recent-first, tolerating rows with no date at all. */
const byOutcomeDateDesc = (
  a: { outcomeDate?: string },
  b: { outcomeDate?: string },
): number => {
  const at = a.outcomeDate ? new Date(a.outcomeDate).getTime() : 0;
  const bt = b.outcomeDate ? new Date(b.outcomeDate).getTime() : 0;
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
  if (Number.isNaN(at)) return 1;
  if (Number.isNaN(bt)) return -1;
  return bt - at;
};

/**
 * The date to order "most recent" by.
 *
 * The agency's own stated date first, then what we recorded. The previous comment
 * here had it backwards — it claimed `winData`/`lossData` are "what the agency did"
 * while `outcomeDate` is "when someone typed it in", but `lossData.lossDate` also
 * defaults to the moment of a UI click, so neither is the agency's word.
 * `agencyStatedAwardDate` is the only value that is. Kept consistent with
 * `resolveAwardDate` so the dashboard and the letter never disagree about a date.
 */
const resolveOutcomeDate = (opp: OpportunityDBItem): string | undefined =>
  opp.agencyStatedAwardDate ??
  opp.winData?.awardDate ??
  opp.lossData?.lossDate ??
  opp.outcomeDate ??
  undefined;

export const buildFoiaDashboard = async (
  orgId: string,
): Promise<FoiaDashboardResponse> => {
  /**
   * Read all three sets concurrently.
   *
   * A failure in any one is fatal on purpose: a dashboard that silently renders
   * partial totals is worse than one that errors, because a reader cannot tell an
   * empty bucket from a failed query.
   */
  const [automations, requests, opportunities] = await Promise.all([
    listFoiaAutomationsByOrg(orgId),
    listFoiaRequestsByOrg(orgId),
    /**
     * A PROJECTED query, not `listOpportunitiesByOrg`.
     *
     * Two reasons, both measured against the largest real org (516 opportunities):
     *
     * 1. That helper appends `enrichWithUserNames`, an extra query against the USER
     *    partition to attach `createdByName`/`updatedByName`. This dashboard reads
     *    neither, so it is a round trip for data nobody displays.
     *
     * 2. Far more important: an opportunity row carries extracted document text and
     *    other bulk fields. Reading every attribute pulls **1.6 MB** over the wire to
     *    compute a handful of counts; the projection below is **146 KB**. Measured
     *    3,282ms unprojected vs 406ms projected — an 8x difference that grows with
     *    every document attached to an opportunity.
     *
     * Keep this list minimal. Adding an attribute here is not free, and the fields
     * below are exactly what the bucketing, pricing and score projections consume.
     */
    queryAllBySkPrefix<OpportunityDBItem>(
      OPPORTUNITY_PK,
      `${orgId}#`,
      'oppId,projectId,title,#status,lossData,winData,outcomeDate,agencyStatedAwardDate,organizationName,solicitationNumber',
      // `status` is a DynamoDB reserved word, so it must go through an alias.
      { '#status': 'status' },
    ),
  ]);

  const automationByOpp = new Map<string, FoiaAutomationDBItem>();
  for (const automation of automations) {
    if (automation.oppId) automationByOpp.set(automation.oppId, automation);
  }

  const counts = emptyCounts();
  const responseOutcomeCounts: Partial<Record<FoiaResponseOutcome, number>> = {};
  const pricingRows: FoiaPricingComparison[] = [];
  const scoreRows: FoiaScoreComparison[] = [];

  for (const opp of opportunities) {
    const { oppId, projectId } = opp;
    if (!oppId || !projectId) continue;

    const automation = automationByOpp.get(oppId);

    const bucket: FoiaOutcomeBucket | null = resolveFoiaOutcomeBucket({
      automationState: automation?.state,
      responseOutcome: automation?.responseOutcome,
      opportunityStatus: opp.status,
    });

    // Null means no terminal outcome yet — nothing to compare, so it is not on this
    // dashboard at all. Counting it would inflate every denominator.
    if (!bucket) continue;

    counts[bucket] += 1;

    if (automation?.responseOutcome) {
      responseOutcomeCounts[automation.responseOutcome] =
        (responseOutcomeCounts[automation.responseOutcome] ?? 0) + 1;
    }

    const outcomeDate = resolveOutcomeDate(opp);

    /**
     * Pricing is only meaningful on a loss.
     *
     * On a win we ARE the awardee, so "our price vs the winner's price" compares a
     * number to itself. `LossData` is also the only place either amount is stored.
     */
    if (bucket === 'LOST') {
      const ourBidAmount = opp.lossData?.ourBidAmount;
      const winningBidAmount = opp.lossData?.winningBidAmount;

      pricingRows.push({
        oppId,
        projectId,
        title: opp.title ?? oppId,
        ...(opp.organizationName ? { agencyName: opp.organizationName } : {}),
        ...(opp.solicitationNumber ? { solicitationNumber: opp.solicitationNumber } : {}),
        ...(typeof ourBidAmount === 'number' ? { ourBidAmount } : {}),
        ...(typeof winningBidAmount === 'number' ? { winningBidAmount } : {}),
        ...(opp.lossData?.winningContractor
          ? { winningContractor: opp.lossData.winningContractor }
          : {}),
        ...(outcomeDate ? { outcomeDate } : {}),
        // Chartable only with BOTH sides. One bar alone invites the reader to
        // guess the other, which is the error this flag exists to prevent.
        hasPricing:
          typeof ourBidAmount === 'number' && typeof winningBidAmount === 'number',
      });

      /**
       * A row is worth showing if EITHER side was scored.
       *
       * Guarding on our own scores alone would drop a release that discloses only the
       * winner's numbers — which happens, because a comparative tabulation names the
       * awardee's scores whether or not we ever requested a debrief for ourselves.
       */
      if (opp.lossData?.evaluationScores || opp.lossData?.winnerScores) {
        scoreRows.push({
          oppId,
          projectId,
          title: opp.title ?? oppId,
          ...(opp.organizationName ? { agencyName: opp.organizationName } : {}),
          // Falls back to an empty object so the shape stays stable when only the
          // winner's side is on file; the UI renders per-criterion, not per-row.
          ourScores: opp.lossData.evaluationScores ?? {},
          ...(opp.lossData.winnerScores ? { winnerScores: opp.lossData.winnerScores } : {}),
          ...(outcomeDate ? { outcomeDate } : {}),
        });
      }
    }
  }

  const chartable = pricingRows.filter((row) => row.hasPricing);

  /**
   * Coverage is reported over ALL loss rows, not just the charted ones.
   *
   * This is what lets the UI say "5 of 40 have pricing recorded" instead of drawing
   * five bars and implying that is the whole picture. These amounts are typed in on
   * the loss form rather than extracted from the FOIA response, so a low number here
   * is a data-entry finding, not a bug.
   */
  const pricingCoverage = {
    withPricing: chartable.length,
    total: pricingRows.length,
  };

  const documentCount = requests.reduce(
    (total, request) => total + (request.responseDocuments?.length ?? 0),
    0,
  );

  const sentCount = requests.filter((request) => Boolean(request.sentAt)).length;

  return {
    orgId,
    counts,
    pricing: chartable.sort(byOutcomeDateDesc).slice(0, FOIA_PRICING_CHART_LIMIT),
    pricingCoverage,
    scores: scoreRows.sort(byOutcomeDateDesc),
    documentCount,
    sentCount,
    responseOutcomeCounts,
    calculatedAt: nowIso(),
  };
};
