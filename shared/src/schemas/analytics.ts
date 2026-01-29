import { z } from 'zod';

// Loss reason categories for tracking why projects were lost
export const LossReasonCategories = [
  'PRICE_TOO_HIGH',
  'TECHNICAL_SCORE',
  'PAST_PERFORMANCE',
  'INCUMBENT_ADVANTAGE',
  'COMPLIANCE_ISSUE',
  'TIMELINE_MISMATCH',
  'TEAM_QUALIFICATIONS',
  'SCOPE_MISALIGNMENT',
  'MISSING_CERTIFICATIONS',
  'OTHER',
  'UNKNOWN',
] as const;

export type LossReasonCategory = (typeof LossReasonCategories)[number];

export const LossReasonCategorySchema = z.enum(LossReasonCategories);

// Monthly analytics schema
export const MonthlyAnalyticsSchema = z.object({
  orgId: z.string(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
  totalProjects: z.number().int().min(0),
  projectsSubmitted: z.number().int().min(0),
  projectsWon: z.number().int().min(0),
  projectsLost: z.number().int().min(0),
  projectsNoBid: z.number().int().min(0),
  projectsWithdrawn: z.number().int().min(0),
  projectsPending: z.number().int().min(0),
  totalPipelineValue: z.number().min(0),
  totalWonValue: z.number().min(0),
  totalLostValue: z.number().min(0),
  averageContractValue: z.number().min(0),
  averageTimeToSubmit: z.number().min(0),
  averageTimeToDecision: z.number().min(0),
  lossReasonCounts: z.record(z.string(), z.number()),
  winRate: z.number().min(0).max(100),
  submissionRate: z.number().min(0).max(100),
  foiaRequestsGenerated: z.number().int().min(0),
  foiaResponsesReceived: z.number().int().min(0),
  calculatedAt: z.string(),
  projectIds: z.array(z.string()),
});

export type MonthlyAnalytics = z.infer<typeof MonthlyAnalyticsSchema>;

// Analytics summary for period aggregation
export const AnalyticsSummarySchema = z.object({
  totalProjects: z.number().int().min(0),
  totalSubmitted: z.number().int().min(0),
  totalWon: z.number().int().min(0),
  totalLost: z.number().int().min(0),
  totalNoBid: z.number().int().min(0),
  totalPipelineValue: z.number().min(0),
  totalWonValue: z.number().min(0),
  totalLostValue: z.number().min(0),
  averageContractValue: z.number().min(0),
  winRate: z.number().min(0).max(100),
  submissionRate: z.number().min(0).max(100),
  averageTimeToSubmit: z.number().min(0),
  averageTimeToDecision: z.number().min(0),
  lossReasonCounts: z.record(z.string(), z.number()),
  topLossReason: LossReasonCategorySchema.optional(),
  periodStart: z.string(),
  periodEnd: z.string(),
  monthCount: z.number().int().min(1),
});

export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

// Loss breakdown for detailed analysis
export const LossReasonBreakdownSchema = z.object({
  reason: LossReasonCategorySchema,
  count: z.number().int().min(0),
  percentage: z.number().min(0).max(100),
  totalValue: z.number().min(0),
  averageValue: z.number().min(0),
  projects: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      contractValue: z.number().min(0),
      lostDate: z.string(),
    })
  ),
});

export type LossReasonBreakdown = z.infer<typeof LossReasonBreakdownSchema>;

// Request schemas
export const GetAnalyticsRequestSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  startMonth: z.string().regex(/^\d{4}-\d{2}$/, 'startMonth must be in YYYY-MM format'),
  endMonth: z.string().regex(/^\d{4}-\d{2}$/, 'endMonth must be in YYYY-MM format'),
});

export type GetAnalyticsRequest = z.infer<typeof GetAnalyticsRequestSchema>;

export const RecalculateAnalyticsRequestSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be in YYYY-MM format'),
});

export type RecalculateAnalyticsRequest = z.infer<typeof RecalculateAnalyticsRequestSchema>;

// Helper functions

/**
 * Format a date to YYYY-MM format
 */
export function formatMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get all months between start and end (inclusive)
 */
export function getMonthsInRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [startYear, startM] = startMonth.split('-').map(Number);
  const [endYear, endM] = endMonth.split('-').map(Number);

  let currentYear = startYear!;
  let currentMonth = startM!;

  while (
    currentYear < endYear! ||
    (currentYear === endYear && currentMonth <= endM!)
  ) {
    months.push(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }

  return months;
}

/**
 * Calculate win rate percentage
 */
export function calculateWinRate(won: number, lost: number): number {
  const total = won + lost;
  if (total === 0) return 0;
  return Number(((won / total) * 100).toFixed(2));
}

/**
 * Calculate submission rate percentage
 */
export function calculateSubmissionRate(submitted: number, total: number): number {
  if (total === 0) return 0;
  return Number(((submitted / total) * 100).toFixed(2));
}
