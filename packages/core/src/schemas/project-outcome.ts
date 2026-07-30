import { z } from 'zod';
import { LossReasonCategorySchema } from './outcome-detail';

/**
 * The standalone ProjectOutcome record has been retired: an opportunity's outcome
 * now lives directly on the Opportunity entity (status + outcomeComment + winData /
 * lossData + jurisdiction/state). The reusable win/loss building blocks live in
 * ./outcome-detail and are re-exported here for back-compat.
 *
 * What remains in this file is the separate "historical import" feature
 * (bulk-importing past win/loss records), which is not tied to a live opportunity.
 */

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
