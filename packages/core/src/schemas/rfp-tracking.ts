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
  RfpPipelineStageSchema,
} from './opportunity';
import type { RfpPipelineStage } from './opportunity';
import { WinDataSchema, LossDataSchema } from './outcome-detail';

// ─── RFP board stage model (mirrors the Linear "Government Contracting" board) ──

/**
 * The Linear workflow statuses on the Government Contracting board. New RFPs
 * land in "To be Reviewed"; "Todo"/"Backlog" hold internal admin tickets.
 */
export const RFP_LINEAR_STATUS = {
  TODO: 'Todo',
  BACKLOG: 'Backlog',
  TO_BE_REVIEWED: 'To be Reviewed',
  REVIEWED_APPROVED: 'Reviewed - Approved',
  REVIEWED_NOT_APPROVED: 'Reviewed / Not Approved',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  AWARDED: 'Awarded',
} as const;

/**
 * The two later approval gates exist only as Linear labels — the board has no
 * status for them — so stage resolution must read labels as well as status.
 */
export const RFP_LINEAR_LABEL = {
  FIRST_APPROVED: 'I Approved',
  SECOND_APPROVED: 'II Approved',
  PRE_SUB_APPROVAL: 'Pre Sub Approval',
  DID_NOT_WIN: 'dnw',
  SKIP: 'skip',
  EXPIRED: 'expired',
  CANCELLED_BID: 'Cancelled Bid',
} as const;

/**
 * Statuses that are not part of the RFP lifecycle and must not appear on the
 * board. `Todo` holds internal admin/training tickets on this board, not RFPs.
 */
export const RFP_NON_LIFECYCLE_STATUSES: readonly string[] = [
  'Todo',
  'Done',
  'Duplicate',
  'Important Information',
  'Task checklist',
];

/** Internal admin/report tickets that live on the RFP board but are not RFPs. */
export const RFP_EXCLUDED_IDENTIFIERS: readonly string[] = ['HOR-2073', 'HOR-1488'];

/** Human-readable board column labels (exact digest wording). */
export const RFP_STAGE_LABELS: Record<RfpPipelineStage, string> = {
  found: 'Found',
  execSummaryToReview: 'Exec summary, to be reviewed',
  firstApproved: 'First approved',
  inProgress: 'In progress',
  preSubmissionReview: 'Pre-submission review',
  secondApproved: 'Second approved',
  submitted: 'Submitted',
  notApproved: 'Not approved',
  awarded: 'Awarded',
  lost: 'Lost',
  expired: 'Expired',
};

/** Tailwind badge classes per stage. */
export const RFP_STAGE_COLORS: Record<RfpPipelineStage, string> = {
  found: 'bg-slate-100 text-slate-600 border-slate-200',
  execSummaryToReview: 'bg-amber-100 text-amber-700 border-amber-200',
  firstApproved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  inProgress: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  preSubmissionReview: 'bg-orange-100 text-orange-700 border-orange-200',
  secondApproved: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  notApproved: 'bg-red-100 text-red-700 border-red-200',
  awarded: 'bg-green-100 text-green-700 border-green-200',
  lost: 'bg-rose-100 text-rose-700 border-rose-200',
  expired: 'bg-gray-100 text-gray-500 border-gray-200',
};

/**
 * Live inventory — every open issue, counted regardless of age. `found`
 * (Todo/Backlog) is intentionally excluded from the board: those are freshly
 * sourced/admin rows that haven't entered the review funnel yet.
 */
export const RFP_OPEN_STAGES = [
  'execSummaryToReview',
  'firstApproved',
  'inProgress',
  'preSubmissionReview',
  'secondApproved',
] as const satisfies readonly RfpPipelineStage[];

/**
 * Throughput — only counted within the terminal window (RFP_TERMINAL_WINDOW_DAYS).
 * `notApproved` is intentionally excluded from the board (a rejected bid has left
 * the active pipeline); submitted/awarded/lost outcomes are shown.
 */
export const RFP_TERMINAL_STAGES = [
  'submitted',
  'awarded',
  'lost',
] as const satisfies readonly RfpPipelineStage[];

/**
 * Standing stages (shown regardless of age). `expired` is intentionally NOT a
 * board column — stale intake is reclassified to it by the sync purely so it
 * drops out of the live review queue, not so it gets its own column.
 */
export const RFP_STANDING_STAGES = [] as const satisfies readonly RfpPipelineStage[];

/** Board column order: open funnel, then standing, then terminal outcomes. */
export const RFP_BOARD_STAGE_ORDER: RfpPipelineStage[] = [
  ...RFP_OPEN_STAGES,
  ...RFP_STANDING_STAGES,
  ...RFP_TERMINAL_STAGES,
];

/** Terminal stages are only shown/counted if they closed within this many days. */
export const RFP_TERMINAL_WINDOW_DAYS = 30;

const isOpenStage = (stage: RfpPipelineStage): boolean =>
  (RFP_OPEN_STAGES as readonly RfpPipelineStage[]).includes(stage);
const isStandingStage = (stage: RfpPipelineStage): boolean =>
  (RFP_STANDING_STAGES as readonly RfpPipelineStage[]).includes(stage);

/** Open and standing stages are shown regardless of age; terminals must be recent. */
export const isStageAlwaysShown = (stage: RfpPipelineStage): boolean =>
  isOpenStage(stage) || isStandingStage(stage);

/** A Linear issue as stage resolution needs it. */
export interface RfpStageInput {
  identifier: string;
  status: string;
  labels: string[];
}

/**
 * Should this issue appear on the RFP board at all? Retired rows (skip label),
 * non-lifecycle statuses, and known admin tickets are excluded.
 */
export const isTrackedRfpIssue = (issue: RfpStageInput): boolean =>
  !issue.labels.includes(RFP_LINEAR_LABEL.SKIP) &&
  !RFP_NON_LIFECYCLE_STATUSES.includes(issue.status) &&
  !RFP_EXCLUDED_IDENTIFIERS.includes(issue.identifier);

/**
 * Resolve the board stage from Linear status + labels. Ordered, first-match-wins:
 * order is load-bearing because gate labels are additive and never removed (a
 * Submitted issue still carries "I Approved"), and ~15% of issues carry labels
 * that contradict their status. Returns null for non-lifecycle/untracked issues.
 */
export const resolveRfpStage = (issue: RfpStageInput): RfpPipelineStage | null => {
  const { status, labels } = issue;
  const has = (label: string) => labels.includes(label);

  if (!isTrackedRfpIssue(issue)) return null;

  if (status === RFP_LINEAR_STATUS.AWARDED) {
    return has(RFP_LINEAR_LABEL.DID_NOT_WIN) ? 'lost' : 'awarded';
  }
  if (status === RFP_LINEAR_STATUS.SUBMITTED) return 'submitted';
  if (status === RFP_LINEAR_STATUS.REVIEWED_NOT_APPROVED) return 'notApproved';
  // After the real outcomes but before the open stages: a passed deadline kills
  // an in-flight bid, but it doesn't rewrite one that already resolved.
  if (has(RFP_LINEAR_LABEL.EXPIRED)) return 'expired';
  if (has(RFP_LINEAR_LABEL.SECOND_APPROVED)) return 'secondApproved';
  if (has(RFP_LINEAR_LABEL.PRE_SUB_APPROVAL)) return 'preSubmissionReview';
  if (status === RFP_LINEAR_STATUS.IN_PROGRESS) return 'inProgress';
  if (status === RFP_LINEAR_STATUS.REVIEWED_APPROVED || has(RFP_LINEAR_LABEL.FIRST_APPROVED)) {
    return 'firstApproved';
  }
  if (status === RFP_LINEAR_STATUS.TO_BE_REVIEWED) return 'execSummaryToReview';
  if (status === RFP_LINEAR_STATUS.TODO || status === RFP_LINEAR_STATUS.BACKLOG) return 'found';
  return null;
};

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
  /** ISO datetime a terminal stage (submitted/awarded/lost) completed — for the closed-window cutoff. */
  completedAt: z.string().nullish(),
  /** The Linear-mirroring board stage (set by the sync). */
  pipelineStage: RfpPipelineStageSchema.optional(),
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
