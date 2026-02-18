import { z } from 'zod';

/**
 * Loss Reason Categories
 */
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

/**
 * Project Outcome Status
 */
export const ProjectOutcomeStatusSchema = z.enum([
  'WON',
  'LOST',
  'NO_BID',
  'WITHDRAWN',
  'PENDING',
]);

export type ProjectOutcomeStatus = z.infer<typeof ProjectOutcomeStatusSchema>;

/**
 * Status Source - how the status was determined
 */
export const StatusSourceSchema = z.enum(['MANUAL', 'SAM_GOV_SYNC']);

export type StatusSource = z.infer<typeof StatusSourceSchema>;

/**
 * Period of Performance
 */
export const PeriodOfPerformanceSchema = z.object({
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  optionYears: z.number().int().min(0).max(10).optional(),
});

export type PeriodOfPerformance = z.infer<typeof PeriodOfPerformanceSchema>;

/**
 * Win Data - captured when project is marked as WON
 */
export const WinDataSchema = z.object({
  contractNumber: z.string().min(1).optional(),
  contractValue: z.number().nonnegative(),
  awardDate: z.string().datetime({ offset: true }),
  periodOfPerformance: PeriodOfPerformanceSchema.optional(),
  competitorsBeaten: z.array(z.string().min(1)).optional(),
  keyFactors: z.string().optional(),
});

export type WinData = z.infer<typeof WinDataSchema>;

/**
 * Evaluation Scores - from debriefing or FOIA response
 */
export const EvaluationScoresSchema = z.object({
  technical: z.number().min(0).max(100).optional(),
  price: z.number().min(0).max(100).optional(),
  pastPerformance: z.number().min(0).max(100).optional(),
  management: z.number().min(0).max(100).optional(),
  overall: z.number().min(0).max(100).optional(),
});

export type EvaluationScores = z.infer<typeof EvaluationScoresSchema>;

/**
 * Loss Data - captured when project is marked as LOST
 */
export const LossDataSchema = z.object({
  lossDate: z.string().datetime({ offset: true }),
  lossReason: LossReasonCategorySchema,
  lossReasonDetails: z.string().optional(),
  winningContractor: z.string().optional(),
  winningBidAmount: z.number().nonnegative().optional(),
  ourBidAmount: z.number().nonnegative().optional(),
  evaluationScores: EvaluationScoresSchema.optional(),
});

export type LossData = z.infer<typeof LossDataSchema>;

/**
 * Project Outcome - the complete outcome record
 */
export const ProjectOutcomeSchema = z.object({
  projectId: z.string().min(1),
  orgId: z.string().min(1),
  opportunityId: z.string().min(1).optional(),
  status: ProjectOutcomeStatusSchema,
  statusDate: z.string().datetime({ offset: true }),
  statusSetBy: z.string().min(1),
  statusSource: StatusSourceSchema,
  winData: WinDataSchema.optional(),
  lossData: LossDataSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ProjectOutcome = z.infer<typeof ProjectOutcomeSchema>;

/**
 * Set Outcome Request DTO
 */
export const SetProjectOutcomeRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  orgId: z.string().min(1, 'Organization ID is required'),
  opportunityId: z.string().min(1, 'Opportunity ID is required'),
  status: ProjectOutcomeStatusSchema,
  winData: WinDataSchema.optional(),
  lossData: LossDataSchema.optional(),
}).superRefine((data, ctx) => {
  // Validate that winData is provided for WON status
  if (data.status === 'WON' && !data.winData) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Win data is required when status is WON',
      path: ['winData'],
    });
  }

  // Validate that lossData is provided for LOST status
  if (data.status === 'LOST' && !data.lossData) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Loss data is required when status is LOST',
      path: ['lossData'],
    });
  }

  // Validate that winData is NOT provided for non-WON statuses
  if (data.status !== 'WON' && data.winData) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Win data should only be provided when status is WON',
      path: ['winData'],
    });
  }

  // Validate that lossData is NOT provided for non-LOST statuses
  if (data.status !== 'LOST' && data.lossData) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Loss data should only be provided when status is LOST',
      path: ['lossData'],
    });
  }
});

export type SetProjectOutcomeRequest = z.infer<typeof SetProjectOutcomeRequestSchema>;

/**
 * Get Outcome Response
 */
export const GetProjectOutcomeResponseSchema = z.object({
  outcome: ProjectOutcomeSchema.nullable(),
});

export type GetProjectOutcomeResponse = z.infer<typeof GetProjectOutcomeResponseSchema>;

/**
 * Historical Import Record
 */
export const HistoricalRecordSchema = z.object({
  projectName: z.string().min(1, 'Project name is required'),
  solicitationNumber: z.string().optional(),
  agency: z.string().optional(),
  status: z.enum(['WON', 'LOST', 'NO_BID']),
  statusDate: z.string().datetime({ offset: true }),
  contractValue: z.number().nonnegative().optional(),
  ourBidAmount: z.number().nonnegative().optional(),
  lossReason: LossReasonCategorySchema.optional(),
  notes: z.string().optional(),
});

export type HistoricalRecord = z.infer<typeof HistoricalRecordSchema>;

/**
 * Import Historical Request
 */
export const ImportHistoricalRequestSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  records: z.array(HistoricalRecordSchema).min(1, 'At least one record is required'),
});

export type ImportHistoricalRequest = z.infer<typeof ImportHistoricalRequestSchema>;

/**
 * Import Error
 */
export const ImportErrorSchema = z.object({
  index: z.number().int().nonnegative(),
  projectName: z.string(),
  error: z.string(),
});

export type ImportError = z.infer<typeof ImportErrorSchema>;

/**
 * Import Result
 */
export const ImportResultSchema = z.object({
  imported: z.number().int().nonnegative(),
  errors: z.array(ImportErrorSchema),
});

export type ImportResult = z.infer<typeof ImportResultSchema>;

/**
 * Loss Reason Labels - human readable labels for loss reasons
 */
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
