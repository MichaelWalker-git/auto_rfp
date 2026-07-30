import { z } from 'zod';
import { RfpPipelineStageSchema, type RfpPipelineStage } from './opportunity';

/**
 * Stages 1–6 count every open issue; 7/3b/8 are counted over a rolling window
 * because lifetime totals are dominated by years of closed work.
 */
export const RFP_DIGEST_OPEN_STAGES = [
  'found',
  'execSummaryToReview',
  'firstApproved',
  'inProgress',
  'preSubmissionReview',
  'secondApproved',
] as const satisfies readonly RfpPipelineStage[];

export const RFP_DIGEST_TERMINAL_STAGES = [
  'submitted',
  'notApproved',
  'awarded',
  'lost',
] as const satisfies readonly RfpPipelineStage[];

/**
 * Deadline passed while the issue was still open. Neither open (it's dead) nor
 * windowed like a terminal stage — it stays counted until someone cleans it up.
 */
export const RFP_DIGEST_STANDING_STAGES = ['expired'] as const satisfies readonly RfpPipelineStage[];

export const RfpStageCountsSchema = z.record(RfpPipelineStageSchema, z.number().int().nonnegative());
export type RfpStageCounts = z.infer<typeof RfpStageCountsSchema>;

/** A single issue as the digest needs it — flattened from the Linear GraphQL response. */
export const RfpDigestIssueSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  assigneeName: z.string().optional(),
  creatorName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});
export type RfpDigestIssue = z.infer<typeof RfpDigestIssueSchema>;

export const RfpDigestIssueRefSchema = z.object({
  identifier: z.string(),
  title: z.string(),
});
export type RfpDigestIssueRef = z.infer<typeof RfpDigestIssueRefSchema>;

/**
 * Per-person movement since the previous digest. `noGo` is derived from
 * `updatedAt` because the board records no completion timestamp for
 * `Reviewed / Not Approved`; the other three come from real transition stamps.
 */
export const RfpPersonProgressSchema = z.object({
  name: z.string(),
  submitted: z.array(RfpDigestIssueRefSchema),
  noGo: z.array(RfpDigestIssueRefSchema),
  started: z.array(RfpDigestIssueRefSchema),
  sourced: z.array(RfpDigestIssueRefSchema),
  openByStage: RfpStageCountsSchema,
});
export type RfpPersonProgress = z.infer<typeof RfpPersonProgressSchema>;

export const RfpDigestRowSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  assigneeName: z.string().optional(),
  ageDays: z.number().int().nonnegative().optional(),
  /** Which approval gate this row is blocked on, so the digest can @-mention the right approver. */
  stage: RfpPipelineStageSchema,
});
export type RfpDigestRow = z.infer<typeof RfpDigestRowSchema>;

export const RfpDigestSchema = z.object({
  generatedAt: z.string(),
  windowDays: z.number().int().positive(),
  stageCounts: RfpStageCountsSchema,
  people: z.array(RfpPersonProgressSchema),
  awaitingApproval: z.array(RfpDigestRowSchema),
  awaitingApprovalTotal: z.number().int().nonnegative(),
});
export type RfpDigest = z.infer<typeof RfpDigestSchema>;
