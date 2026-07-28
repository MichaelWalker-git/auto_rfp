/**
 * rfp-tracking.ts
 *
 * Schemas for the RFP Tracking dashboard (pipeline board, approval queue,
 * needs-attention flags). Built on the native Opportunity entity — the board
 * card shape reuses OpportunityListItem fields plus the append-only
 * statusHistory and dollar value the client needs to derive days-in-stage,
 * approval age, and integrity flags.
 */

import { z } from 'zod';
import {
  OpportunityListItemSchema,
  OpportunityStatusTransitionSchema,
  OpportunityApprovalTransitionSchema,
} from './opportunity';
import { WinDataSchema, LossDataSchema } from './outcome-detail';

// ─── Pipeline board item ────────────────────────────────────────────────────

/**
 * The shape the board/queue/flags derive from. Everything the client reads:
 * the list-card fields, plus statusHistory / approvalHistory (days-in-stage,
 * approval age, submitted-without-approval detection), the dollar value, and the
 * terminal outcome detail used to flag WON/LOST records that lack it.
 */
export const RfpPipelineItemSchema = OpportunityListItemSchema.extend({
  statusHistory: z.array(OpportunityStatusTransitionSchema).optional(),
  approvalHistory: z.array(OpportunityApprovalTransitionSchema).optional(),
  baseAndAllOptionsValue: z.number().nonnegative().nullable().optional(),
  updatedAt: z.string().nullish(),
  winData: WinDataSchema.optional(),
  lossData: LossDataSchema.optional(),
});
export type RfpPipelineItem = z.infer<typeof RfpPipelineItemSchema>;

export const GetRfpPipelineResponseSchema = z.object({
  items: z.array(RfpPipelineItemSchema),
});
export type GetRfpPipelineResponse = z.infer<typeof GetRfpPipelineResponseSchema>;

// ─── Approval decision (gate write-back) ────────────────────────────────────

/**
 * A gate decision. INITIAL is gate 1 (Brennen), FINAL is gate 2 (Michael).
 *   INITIAL + APPROVE → I_APPROVED
 *   INITIAL + REJECT  → NOT_APPROVED
 *   FINAL   + APPROVE → II_APPROVED
 *   FINAL   + REJECT  → invalid (no reject at gate 2 — enforced in handler).
 */
export const RfpApprovalDecisionSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  gate: z.enum(['INITIAL', 'FINAL']),
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().optional(),
});
export type RfpApprovalDecision = z.infer<typeof RfpApprovalDecisionSchema>;

// ─── Approval advance (non-gate stage moves) ────────────────────────────────

/**
 * The non-gate stage moves that don't require an approver:
 *   I_APPROVED  → PRE_SUB_APPROVAL  "send for pre-sub review"
 *   II_APPROVED → SUBMITTED         "mark submitted"
 */
export const RfpApprovalAdvanceSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  to: z.enum(['PRE_SUB_APPROVAL', 'SUBMITTED']),
});
export type RfpApprovalAdvance = z.infer<typeof RfpApprovalAdvanceSchema>;
