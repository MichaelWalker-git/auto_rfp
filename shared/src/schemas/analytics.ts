import { z } from 'zod';
import { LossReasonCategorySchema } from './project-outcome';

/**
 * Monthly Analytics Item - aggregated analytics for an org by month
 */
export const MonthlyAnalyticsSchema = z.object({
  orgId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),

  // Volume metrics
  totalProjects: z.number().int().nonnegative(),
  projectsSubmitted: z.number().int().nonnegative(),
  projectsWon: z.number().int().nonnegative(),
  projectsLost: z.number().int().nonnegative(),
  projectsNoBid: z.number().int().nonnegative(),
  projectsWithdrawn: z.number().int().nonnegative(),
  projectsPending: z.number().int().nonnegative(),

  // Financial metrics
  totalPipelineValue: z.number().nonnegative(),
  totalWonValue: z.number().nonnegative(),
  totalLostValue: z.number().nonnegative(),
  averageContractValue: z.number().nonnegative(),

  // Time metrics (in days)
  averageTimeToSubmit: z.number().nonnegative(),
  averageTimeToDecision: z.number().nonnegative(),

  // Loss reason breakdown
  lossReasonCounts: z.record(LossReasonCategorySchema, z.number().int().nonnegative()),

  // Computed metrics
  winRate: z.number().min(0).max(100),
  submissionRate: z.number().min(0).max(100),

  // FOIA metrics
  foiaRequestsGenerated: z.number().int().nonnegative(),
  foiaResponsesReceived: z.number().int().nonnegative(),

  // Metadata
  calculatedAt: z.string().datetime({ offset: true }),
  projectIds: z.array(z.string().min(1)),
});

export type MonthlyAnalytics = z.infer<typeof MonthlyAnalyticsSchema>;

/**
 * Analytics Summary - aggregated over a date range
 */
export const AnalyticsSummarySchema = z.object({
  // Volume totals
  totalProjects: z.number().int().nonnegative(),
  totalSubmitted: z.number().int().nonnegative(),
  totalWon: z.number().int().nonnegative(),
  totalLost: z.number().int().nonnegative(),
  totalNoBid: z.number().int().nonnegative(),

  // Financial totals
  totalPipelineValue: z.number().nonnegative(),
  totalWonValue: z.number().nonnegative(),
  totalLostValue: z.number().nonnegative(),
  averageContractValue: z.number().nonnegative(),

  // Computed rates
  winRate: z.number().min(0).max(100),
  submissionRate: z.number().min(0).max(100),

  // Time metrics (averages)
  averageTimeToSubmit: z.number().nonnegative(),
  averageTimeToDecision: z.number().nonnegative(),

  // Loss analysis
  lossReasonCounts: z.record(LossReasonCategorySchema, z.number().int().nonnegative()),
  topLossReason: LossReasonCategorySchema.optional(),

  // Period info
  periodStart: z.string().regex(/^\d{4}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}$/),
  monthCount: z.number().int().positive(),
});

export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

/**
 * Get Analytics Request
 */
export const GetAnalyticsRequestSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  startMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Start month must be in YYYY-MM format'),
  endMonth: z.string().regex(/^\d{4}-\d{2}$/, 'End month must be in YYYY-MM format'),
}).superRefine((data, ctx) => {
  if (data.startMonth > data.endMonth) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Start month must be before or equal to end month',
      path: ['startMonth'],
    });
  }
});

export type GetAnalyticsRequest = z.infer<typeof GetAnalyticsRequestSchema>;

/**
 * Get Analytics Response
 */
export const GetAnalyticsResponseSchema = z.object({
  analytics: z.array(MonthlyAnalyticsSchema),
  summary: AnalyticsSummarySchema,
});

export type GetAnalyticsResponse = z.infer<typeof GetAnalyticsResponseSchema>;

/**
 * Org Analytics - for global view
 */
export const OrgAnalyticsSchema = z.object({
  orgId: z.string().min(1),
  orgName: z.string().min(1),
  totalProjects: z.number().int().nonnegative(),
  projectsWon: z.number().int().nonnegative(),
  projectsLost: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(100),
  totalWonValue: z.number().nonnegative(),
  totalPipelineValue: z.number().nonnegative(),
});

export type OrgAnalytics = z.infer<typeof OrgAnalyticsSchema>;

/**
 * Global Analytics Response
 */
export const GlobalAnalyticsResponseSchema = z.object({
  organizations: z.array(OrgAnalyticsSchema),
  summary: AnalyticsSummarySchema,
});

export type GlobalAnalyticsResponse = z.infer<typeof GlobalAnalyticsResponseSchema>;

/**
 * Loss Reason Breakdown
 */
export const LossReasonBreakdownSchema = z.object({
  orgId: z.string().min(1),
  periodStart: z.string().regex(/^\d{4}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}$/),
  totalLosses: z.number().int().nonnegative(),
  breakdown: z.array(
    z.object({
      reason: LossReasonCategorySchema,
      count: z.number().int().nonnegative(),
      percentage: z.number().min(0).max(100),
      totalValue: z.number().nonnegative(),
    })
  ),
});

export type LossReasonBreakdown = z.infer<typeof LossReasonBreakdownSchema>;

/**
 * Export Format
 */
export const ExportFormatSchema = z.enum(['PDF', 'CSV']);

export type ExportFormat = z.infer<typeof ExportFormatSchema>;

/**
 * Export Analytics Request
 */
export const ExportAnalyticsRequestSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  format: ExportFormatSchema,
  startMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Start month must be in YYYY-MM format'),
  endMonth: z.string().regex(/^\d{4}-\d{2}$/, 'End month must be in YYYY-MM format'),
});

export type ExportAnalyticsRequest = z.infer<typeof ExportAnalyticsRequestSchema>;

/**
 * Export Analytics Response
 */
export const ExportAnalyticsResponseSchema = z.object({
  downloadUrl: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
});

export type ExportAnalyticsResponse = z.infer<typeof ExportAnalyticsResponseSchema>;

/**
 * Recalculate Analytics Request
 */
export const RecalculateAnalyticsRequestSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format').optional(),
});

export type RecalculateAnalyticsRequest = z.infer<typeof RecalculateAnalyticsRequestSchema>;

/**
 * Helper: Format month from date
 */
export function formatMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Helper: Get months in range
 */
export function getMonthsInRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [startYear, startMon] = startMonth.split('-').map(Number);
  const [endYear, endMon] = endMonth.split('-').map(Number);

  let currentYear = startYear;
  let currentMon = startMon;

  while (
    currentYear < endYear ||
    (currentYear === endYear && currentMon <= endMon)
  ) {
    months.push(`${currentYear}-${String(currentMon).padStart(2, '0')}`);

    currentMon++;
    if (currentMon > 12) {
      currentMon = 1;
      currentYear++;
    }
  }

  return months;
}

/**
 * Helper: Calculate win rate
 */
export function calculateWinRate(won: number, lost: number): number {
  const total = won + lost;
  if (total === 0) return 0;
  return (won / total) * 100;
}

/**
 * Helper: Calculate submission rate
 */
export function calculateSubmissionRate(submitted: number, total: number): number {
  if (total === 0) return 0;
  return (submitted / total) * 100;
}

/**
 * Empty monthly analytics (for months with no data)
 */
export function createEmptyMonthlyAnalytics(
  orgId: string,
  month: string
): MonthlyAnalytics {
  return {
    orgId,
    month,
    totalProjects: 0,
    projectsSubmitted: 0,
    projectsWon: 0,
    projectsLost: 0,
    projectsNoBid: 0,
    projectsWithdrawn: 0,
    projectsPending: 0,
    totalPipelineValue: 0,
    totalWonValue: 0,
    totalLostValue: 0,
    averageContractValue: 0,
    averageTimeToSubmit: 0,
    averageTimeToDecision: 0,
    lossReasonCounts: {} as Record<string, number>,
    winRate: 0,
    submissionRate: 0,
    foiaRequestsGenerated: 0,
    foiaResponsesReceived: 0,
    calculatedAt: new Date().toISOString(),
    projectIds: [],
  };
}
