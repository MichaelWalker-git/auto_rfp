import { z } from 'zod';

/**
 * Structured detail for an opportunity's terminal outcome (win/loss).
 *
 * These schemas used to live in project-outcome.ts. The standalone ProjectOutcome
 * record was retired and its outcome now lives on the Opportunity (status + these
 * detail fields), so the reusable win/loss building blocks live here as a neutral
 * leaf module that opportunity.ts, analytics.ts, and the (test-only) historical
 * import schemas can all import without creating a dependency cycle.
 */

// ─── Loss Reason Categories ─────────────────────────────────────────────────────

export const LossReasonCategorySchema = z.enum([
  'PRICE_TOO_HIGH',
  'PRICE_TOO_LOW',
  'TECHNICAL_SCORE',
  'PAST_PERFORMANCE',
  'INCUMBENT_ADVANTAGE',
  'MISSING_CERTIFICATION',
  'LATE_SUBMISSION',
  'NON_COMPLIANT',
  'WITHDRAWN',
  'NO_BID_DECISION',
  'UNKNOWN',
  'OTHER',
]);

export type LossReasonCategory = z.infer<typeof LossReasonCategorySchema>;

// ─── Period of Performance ──────────────────────────────────────────────────────

export const PeriodOfPerformanceSchema = z.object({
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  optionYears: z.number().int().min(0).max(10).optional(),
});

export type PeriodOfPerformance = z.infer<typeof PeriodOfPerformanceSchema>;

// ─── Win Data — captured when the outcome is WON ───────────────────────────────

export const WinDataSchema = z.object({
  contractNumber: z.string().min(1).optional(),
  contractValue: z.number().nonnegative(),
  awardDate: z.string().datetime({ offset: true }),
  periodOfPerformance: PeriodOfPerformanceSchema.optional(),
  competitorsBeaten: z.array(z.string().min(1)).optional(),
  keyFactors: z.string().optional(),
});

export type WinData = z.infer<typeof WinDataSchema>;

// ─── Evaluation Scores — from debriefing or FOIA response ──────────────────────

export const EvaluationScoresSchema = z.object({
  technical: z.number().min(0).max(100).optional(),
  price: z.number().min(0).max(100).optional(),
  pastPerformance: z.number().min(0).max(100).optional(),
  management: z.number().min(0).max(100).optional(),
  overall: z.number().min(0).max(100).optional(),
});

export type EvaluationScores = z.infer<typeof EvaluationScoresSchema>;

// ─── Loss Data — captured when the outcome is LOST ─────────────────────────────

export const LossDataSchema = z.object({
  lossDate: z.string().datetime({ offset: true }),
  lossReason: LossReasonCategorySchema,
  lossReasonDetails: z.string().optional(),
  winningContractor: z.string().optional(),
  winningBidAmount: z.number().nonnegative().optional(),
  ourBidAmount: z.number().nonnegative().optional(),
  /** How the agency scored US, from a debrief or a released scoring sheet. */
  evaluationScores: EvaluationScoresSchema.optional(),
  /**
   * How the agency scored the WINNER, where the release discloses it.
   *
   * Separate from `evaluationScores` rather than a field on it, because the two have
   * different provenance and different completeness. Ours usually comes from a debrief
   * we requested; the winner's only appears if the agency released a comparative
   * tabulation, and agencies frequently disclose a total while withholding the
   * criterion breakdown. Keeping them apart lets the dashboard show a half comparison
   * — "they beat us 92 to 61 on price, technical not disclosed" — which is still the
   * most useful thing on the page, instead of hiding the row for want of a full set.
   */
  winnerScores: EvaluationScoresSchema.optional(),
});

export type LossData = z.infer<typeof LossDataSchema>;

// ─── Loss Reason Labels — human readable ───────────────────────────────────────

export const LOSS_REASON_LABELS: Record<LossReasonCategory, string> = {
  PRICE_TOO_HIGH: 'Price Too High',
  PRICE_TOO_LOW: 'Price Too Low (Raised Concerns)',
  TECHNICAL_SCORE: 'Technical Score',
  PAST_PERFORMANCE: 'Past Performance',
  INCUMBENT_ADVANTAGE: 'Incumbent Advantage',
  MISSING_CERTIFICATION: 'Missing Certification',
  LATE_SUBMISSION: 'Late Submission',
  NON_COMPLIANT: 'Non-Compliant',
  WITHDRAWN: 'Withdrawn',
  NO_BID_DECISION: 'No-Bid Decision',
  UNKNOWN: 'Unknown',
  OTHER: 'Other',
};
