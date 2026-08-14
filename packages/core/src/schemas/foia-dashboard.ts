import { z } from 'zod';

import { EvaluationScoresSchema } from './outcome-detail';
import { FoiaResponseOutcomeSchema } from './foia-automation';
import type { FoiaAutomationState } from './foia-automation';
import type { FoiaResponseOutcome } from './foia-automation';

/**
 * Org-wide FOIA comparison dashboard.
 *
 * These are RESPONSE shapes, not stored entities — the dashboard is computed on read
 * from records that already exist (automations, FOIA requests, opportunities), so
 * there is nothing to persist and no Create/Update/DBItem pair to define.
 *
 * The point of the dashboard is to answer "when we lost, how did the winner beat us",
 * which until now was only visible one opportunity at a time.
 */

// ─── Outcome buckets ──────────────────────────────────────────────────────────

/**
 * How a FOIA-tracked opportunity is grouped on the dashboard.
 *
 * `NOT_PRESENT` is the agency reporting it holds no records for us — which is a real
 * and separately interesting outcome, not a missing value. One real reply read "no
 * record of Horus Technology's participation in this solicitation was located",
 * meaning the bid we believed we filed was not on file with the agency. Folding that
 * into LOST would hide it.
 *
 * `CANCELLED` comes from the inbound mail scrape recognising a cancellation notice.
 */
export const FoiaOutcomeBucketSchema = z.enum([
  'WON',
  'LOST',
  'NOT_PRESENT',
  'CANCELLED',
]);

export type FoiaOutcomeBucket = z.infer<typeof FoiaOutcomeBucketSchema>;

export const FOIA_OUTCOME_BUCKET_LABELS: Record<FoiaOutcomeBucket, string> = {
  WON: 'Won',
  LOST: 'Lost',
  NOT_PRESENT: 'No records held',
  CANCELLED: 'Cancelled',
};

/**
 * Buckets a FOIA-tracked opportunity.
 *
 * Lives in core rather than in the aggregation helper so the backend and any UI that
 * re-derives a bucket cannot disagree.
 *
 * PRECEDENCE IS LOAD-BEARING, and is the reason this is a function rather than a
 * lookup on `status`. A cancelled solicitation and one where the agency holds no
 * records are BOTH still WON or LOST on the opportunity record — the outcome field is
 * never cleared. Checking `status` first would therefore make `CANCELLED` and
 * `NOT_PRESENT` unreachable, and the dashboard would show two empty segments while
 * silently over-counting Lost.
 *
 * Order: cancellation (the solicitation itself went away) → no-records (the agency
 * answered, with nothing) → the recorded outcome.
 *
 * @returns the bucket, or null when the opportunity has no terminal outcome and so
 *          does not belong on this dashboard at all.
 */
export const resolveFoiaOutcomeBucket = (args: {
  automationState: FoiaAutomationState | undefined | null;
  responseOutcome: FoiaResponseOutcome | undefined | null;
  opportunityStatus: string | undefined | null;
}): FoiaOutcomeBucket | null => {
  const { automationState, responseOutcome, opportunityStatus } = args;

  if (automationState === 'SUPPRESSED') return 'CANCELLED';
  if (responseOutcome === 'NO_RECORDS_LOCATED') return 'NOT_PRESENT';
  if (opportunityStatus === 'WON') return 'WON';
  if (opportunityStatus === 'LOST') return 'LOST';

  return null;
};

// ─── Counts ───────────────────────────────────────────────────────────────────

export const FoiaDashboardCountsSchema = z.object({
  WON: z.number().int().nonnegative(),
  LOST: z.number().int().nonnegative(),
  NOT_PRESENT: z.number().int().nonnegative(),
  CANCELLED: z.number().int().nonnegative(),
});

export type FoiaDashboardCounts = z.infer<typeof FoiaDashboardCountsSchema>;

// ─── Pricing comparison ───────────────────────────────────────────────────────

/**
 * One row of the "our price vs the winner's" comparison.
 *
 * Both amounts are optional and `hasPricing` is explicit, because these numbers are
 * typed in by a human on the loss form — they are NOT extracted from the FOIA
 * response PDF. A row can therefore exist, and be a genuine FOIA outcome, with no
 * pricing recorded. The UI must be able to say "5 of 12 have pricing" rather than
 * quietly drawing five bars and implying that is all there is.
 */
export const FoiaPricingComparisonSchema = z.object({
  oppId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  agencyName: z.string().optional(),
  solicitationNumber: z.string().optional(),
  ourBidAmount: z.number().nonnegative().optional(),
  winningBidAmount: z.number().nonnegative().optional(),
  winningContractor: z.string().optional(),
  /** ISO date of the recorded outcome, used to order "most recent". */
  outcomeDate: z.string().optional(),
  /** True only when BOTH amounts are present, i.e. the row is chartable. */
  hasPricing: z.boolean(),
});

export type FoiaPricingComparison = z.infer<typeof FoiaPricingComparisonSchema>;

/**
 * How much of the pricing picture we actually hold.
 *
 * Reported uncapped even though the chart shows only the most recent few, so the UI
 * can distinguish "we only have five" from "we have five of forty".
 */
export const FoiaPricingCoverageSchema = z.object({
  withPricing: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export type FoiaPricingCoverage = z.infer<typeof FoiaPricingCoverageSchema>;

// ─── Score comparison ─────────────────────────────────────────────────────────

/**
 * Evaluation scores for one opportunity, as recorded from a debrief or FOIA response.
 *
 * Only our own scores are stored today (`LossData.evaluationScores`); the winner's are
 * carried as an optional field so a later pass can populate them from a released
 * scoring sheet without a schema change. The UI must not imply a comparison it does
 * not have.
 */
export const FoiaScoreComparisonSchema = z.object({
  oppId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  agencyName: z.string().optional(),
  ourScores: EvaluationScoresSchema,
  winnerScores: EvaluationScoresSchema.optional(),
  outcomeDate: z.string().optional(),
});

export type FoiaScoreComparison = z.infer<typeof FoiaScoreComparisonSchema>;

// ─── Response ─────────────────────────────────────────────────────────────────

export const FoiaDashboardResponseSchema = z.object({
  orgId: z.string().min(1),
  counts: FoiaDashboardCountsSchema,
  /** Most recent chartable rows first. Capped — see `pricingCoverage` for the total. */
  pricing: z.array(FoiaPricingComparisonSchema),
  pricingCoverage: FoiaPricingCoverageSchema,
  scores: z.array(FoiaScoreComparisonSchema),
  /** Response documents received across the org, for the admin-only panel. */
  documentCount: z.number().int().nonnegative(),
  /** How many requests have been transmitted, whatever the agency then said. */
  sentCount: z.number().int().nonnegative(),
  /** Breakdown of what agencies actually replied, for the funnel below the donut. */
  responseOutcomeCounts: z.record(FoiaResponseOutcomeSchema, z.number().int().nonnegative()),
  calculatedAt: z.string().datetime({ offset: true }),
});

export type FoiaDashboardResponse = z.infer<typeof FoiaDashboardResponseSchema>;

/** How many pricing rows the chart shows. The requirement asks for the last 5. */
export const FOIA_PRICING_CHART_LIMIT = 5;
