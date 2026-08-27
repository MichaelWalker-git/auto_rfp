/**
 * opportunity.ts
 *
 * Types for STORED / IMPORTED opportunities — records saved to DynamoDB.
 * Search-related types live in search-opportunity.ts.
 *
 * NOTE: OpportunitySourceSchema is defined here (not in search-opportunity.ts)
 * to avoid a circular dependency — search-opportunity.ts imports from here.
 */

import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';
import { JurisdictionSchema } from './foia';
import { FoiaAutomationStateSchema } from './foia-automation';
import { WinDataSchema, LossDataSchema } from './outcome-detail';
import { NotarySummarySchema, NotaryClassificationSourceSchema, NotaryRequirementSchema } from './notary';

const flexibleDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .or(z.string().date());

// ─── Source enum ──────────────────────────────────────────────────────────────

export const OpportunitySourceSchema = z.enum(['SAM_GOV', 'DIBBS', 'HIGHER_GOV', 'MANUAL_UPLOAD']);
export type OpportunitySource = z.infer<typeof OpportunitySourceSchema>;

// ─── Delivery location constraint ───────────────────────────────────────────────

/** Whether the solicitation permits offshore/non-US delivery. */
export const DeliveryLocationConstraintSchema = z.enum(['US_ONLY', 'OFFSHORE_ALLOWED', 'UNKNOWN']);
export type DeliveryLocationConstraint = z.infer<typeof DeliveryLocationConstraintSchema>;

// ─── Pipeline Stage ───────────────────────────────────────────────────────────

/**
 * Opportunity pipeline stages — replaces the binary active/inactive flag.
 *
 * Flow:
 *   IDENTIFIED → QUALIFYING → PURSUING → SUBMITTED → WON | LOST
 *                           ↘ NO_BID
 *                                                  ↘ WITHDRAWN
 *
 * Automatic transitions:
 *   IDENTIFIED  → QUALIFYING  when executive brief generation starts
 *   QUALIFYING  → PURSUING    when brief scoring decision = GO
 *   QUALIFYING  → NO_BID      when brief scoring decision = NO_GO
 *   PURSUING    → SUBMITTED   when project outcome status = PENDING (proposal submitted)
 *   SUBMITTED   → WON         when project outcome status = WON
 *   SUBMITTED   → LOST        when project outcome status = LOST
 *   Any stage   → WITHDRAWN   when project outcome status = WITHDRAWN
 *
 * Manual transitions: any stage can be moved to any other stage by an org admin.
 */
export const OpportunityStatusSchema = z.enum([
  'IDENTIFIED',   // Opportunity found/imported, not yet analyzed
  'QUALIFYING',   // Brief generation in progress, evaluating bid/no-bid
  'PURSUING',     // GO decision made, actively working on proposal
  'SUBMITTED',    // Proposal submitted, awaiting award decision
  'WON',          // Contract awarded to us
  'LOST',         // Contract awarded to competitor
  'NO_BID',       // Decided not to pursue
  'WITHDRAWN',    // Withdrew from competition
]);

export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;

/** Human-readable labels for each pipeline stage */
export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  IDENTIFIED:  'Identified',
  QUALIFYING:  'Qualifying',
  PURSUING:    'Pursuing',
  SUBMITTED:   'Submitted',
  WON:         'Won',
  LOST:        'Lost',
  NO_BID:      'No Bid',
  WITHDRAWN:   'Withdrawn',
};

/** Tailwind color classes for each stage badge */
export const OPPORTUNITY_STATUS_COLORS: Record<OpportunityStatus, string> = {
  IDENTIFIED:  'bg-slate-100 text-slate-700 border-slate-200',
  QUALIFYING:  'bg-blue-100 text-blue-700 border-blue-200',
  PURSUING:    'bg-indigo-100 text-indigo-700 border-indigo-200',
  SUBMITTED:   'bg-amber-100 text-amber-700 border-amber-200',
  WON:         'bg-emerald-100 text-emerald-700 border-emerald-200',
  LOST:        'bg-red-100 text-red-700 border-red-200',
  NO_BID:      'bg-gray-100 text-gray-600 border-gray-200',
  WITHDRAWN:   'bg-gray-100 text-gray-500 border-gray-200',
};

/** Stages that represent active pursuit (not terminal) */
export const ACTIVE_OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  'IDENTIFIED',
  'QUALIFYING',
  'PURSUING',
  'SUBMITTED',
];

/** Terminal stages — no further action expected */
export const TERMINAL_OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  'WON',
  'LOST',
  'NO_BID',
  'WITHDRAWN',
];

/** Stage transition history entry */
export const OpportunityStatusTransitionSchema = z.object({
  from:      OpportunityStatusSchema.nullable(),
  to:        OpportunityStatusSchema,
  changedAt: z.string().datetime(),
  changedBy: z.string().min(1),  // userId or 'system'
  reason:    z.string().optional(),
  source:    z.enum(['MANUAL', 'BRIEF_SCORING', 'SYSTEM']),
});

export type OpportunityStatusTransition = z.infer<typeof OpportunityStatusTransitionSchema>;

// ─── Approval status (RFP-tracking two-gate workflow) ───────────────────────────

/**
 * Approval status — a second axis layered on top of the pipeline `status`,
 * mirroring how the team's Linear board tracks approval as labels on top of the
 * stage. This governs only the pre-submission approval flow through SUBMITTED;
 * it does NOT touch `status` (which drives brief scoring, APN sync, WON/LOST
 * notifications, and the Slack digest).
 *
 * Two approval gates:
 *   INITIAL_APPROVAL → I_APPROVED       gate 1 (Brennen): RFP sourced, awaiting review
 *   I_APPROVED       → PRE_SUB_APPROVAL send for pre-submission review
 *   PRE_SUB_APPROVAL → II_APPROVED      gate 2 (Michael): proposal ready, sign-off
 *   II_APPROVED      → SUBMITTED        e-signed PDF sent
 *   INITIAL_APPROVAL → NOT_APPROVED     gate-1 rejection (terminal dead-end)
 */
export const OpportunityApprovalStatusSchema = z.enum([
  'INITIAL_APPROVAL',  // Pending gate 1 — RFP sourced, awaiting review
  'I_APPROVED',        // Gate 1 passed — reviewed & cleared
  'PRE_SUB_APPROVAL',  // Pending gate 2 — proposal ready, awaiting sign-off
  'II_APPROVED',       // Gate 2 passed — post-signature, cleared to submit
  'SUBMITTED',         // E-signed PDF sent
  'NOT_APPROVED',      // Gate-1 rejection (terminal)
]);

export type OpportunityApprovalStatus = z.infer<typeof OpportunityApprovalStatusSchema>;

/** Human-readable labels — exact Linear label text. */
export const OPPORTUNITY_APPROVAL_LABELS: Record<OpportunityApprovalStatus, string> = {
  INITIAL_APPROVAL: 'Initial Approval',
  I_APPROVED:       'I Approved',
  PRE_SUB_APPROVAL: 'Pre Sub Approval',
  II_APPROVED:      'II Approved',
  SUBMITTED:        'Submitted',
  NOT_APPROVED:     'Not Approved',
};

/** Tailwind badge classes, borrowing the Linear label colors. */
export const OPPORTUNITY_APPROVAL_COLORS: Record<OpportunityApprovalStatus, string> = {
  INITIAL_APPROVAL: 'bg-amber-100 text-amber-700 border-amber-200',
  I_APPROVED:       'bg-emerald-100 text-emerald-700 border-emerald-200',
  PRE_SUB_APPROVAL: 'bg-orange-100 text-orange-700 border-orange-200',
  II_APPROVED:      'bg-cyan-100 text-cyan-700 border-cyan-200',
  SUBMITTED:        'bg-slate-100 text-slate-700 border-slate-200',
  NOT_APPROVED:     'bg-red-100 text-red-700 border-red-200',
};

/** The six approval values in board order — column layout + forward-move checks. */
export const APPROVAL_ORDER: OpportunityApprovalStatus[] = [
  'INITIAL_APPROVAL',
  'I_APPROVED',
  'PRE_SUB_APPROVAL',
  'II_APPROVED',
  'SUBMITTED',
  'NOT_APPROVED',
];

/** Approval transition history entry (parallels OpportunityStatusTransition). */
export const OpportunityApprovalTransitionSchema = z.object({
  from:      OpportunityApprovalStatusSchema.nullable(),
  to:        OpportunityApprovalStatusSchema,
  changedAt: z.string().datetime(),
  changedBy: z.string().min(1),  // userId or 'system'
  reason:    z.string().optional(),
  gate:      z.enum(['INITIAL', 'FINAL', 'STAGE']),
});

export type OpportunityApprovalTransition = z.infer<typeof OpportunityApprovalTransitionSchema>;

// ─── RFP-tracking board stage (Linear-mirroring, 11-stage model) ───────────────

/**
 * The RFP-tracking board stages — a faithful mirror of the team's Linear
 * "Government Contracting" board, derived from Linear workflow status + gate
 * labels (first-match-wins; see resolveRfpStage in rfp-tracking.ts). This is a
 * presentation axis for the board and is independent of both `status` (brief
 * scoring / outcome) and `approvalStatus` (the two-gate approval queue).
 *
 * Open stages (counted all-time):
 *   found → execSummaryToReview → firstApproved → inProgress
 *         → preSubmissionReview → secondApproved
 * Terminal stages (counted over a rolling window):
 *   submitted · notApproved · awarded · lost
 * Standing stage (counted until cleaned up):
 *   expired
 */
export const RfpPipelineStageSchema = z.enum([
  'found',
  'execSummaryToReview',
  'firstApproved',
  'inProgress',
  'preSubmissionReview',
  'secondApproved',
  'submitted',
  'notApproved',
  'awarded',
  'lost',
  'expired',
]);
export type RfpPipelineStage = z.infer<typeof RfpPipelineStageSchema>;

// ─── Stored opportunity item ──────────────────────────────────────────────────

export const OpportunityItemSchema = z.object({
  orgId:     z.string().optional(),
  projectId: z.string().optional(),
  oppId:     z.string().optional(),
  source:    OpportunitySourceSchema,
  id:        z.string().min(1),
  title:     z.string().min(1),
  type:      z.string().nullable(),
  postedDateIso:       flexibleDateSchema.nullable(),
  responseDeadlineIso: flexibleDateSchema.nullable(),
  noticeId:            z.string().nullable(),
  solicitationNumber:  z.string().nullable(),
  naicsCode:           z.string().nullable(),
  /** PSC / classification code — kept for pipeline filtering */
  pscCode:             z.string().nullable(),
  /** Issuing agency name */
  organizationName:    z.string().nullable(),
  /** Set-aside description */
  setAside:            z.string().nullable(),
  description:         z.string().nullable(),
  /**
   * Opportunity status — the unified pipeline + outcome state.
   * Pipeline: IDENTIFIED → QUALIFYING → PURSUING → SUBMITTED.
   * Terminal (the outcome): WON | LOST | NO_BID | WITHDRAWN.
   * Defaults to IDENTIFIED for new opportunities (applied at the DB/helper layer).
   */
  status:              OpportunityStatusSchema.optional(),
  /**
   * Kept for backward compatibility with existing DB records.
   * Derived from status: active = status is in ACTIVE_OPPORTUNITY_STATUSES.
   * Do not set this directly — use status instead.
   * @deprecated Use `status` instead.
   */
  active:              z.boolean().optional(),
  /** History of status transitions */
  statusHistory:       z.array(OpportunityStatusTransitionSchema).optional(),
  /**
   * Approval status — the RFP-tracking two-gate axis, independent of `status`.
   * Defaults to INITIAL_APPROVAL for new opportunities (applied at the create
   * helper); existing records without it default on read.
   */
  approvalStatus:      OpportunityApprovalStatusSchema.optional(),
  /** History of approval transitions */
  approvalHistory:     z.array(OpportunityApprovalTransitionSchema).optional(),
  /**
   * RFP-tracking board stage — the 11-stage model that mirrors the Linear
   * "Government Contracting" board (status + gate labels, first-match-wins).
   * Set by the Linear sync; the board groups columns by this. See
   * RfpPipelineStageSchema in rfp-tracking.ts.
   */
  pipelineStage:       RfpPipelineStageSchema.optional(),
  /**
   * ISO datetime the record reached a terminal stage (submitted/awarded/lost).
   * Set by the Linear sync from the issue's completedAt; the board uses it for
   * the closed-window cutoff so terminal columns show only recent throughput.
   */
  completedAt:         z.string().datetime().nullish(),
  baseAndAllOptionsValue: z.number().nonnegative().nullable(),
  // ── Outcome detail (formerly the standalone ProjectOutcome record) ──────────
  /** Free-form outcome reason / comment (e.g. why a no-bid). */
  outcomeComment: z.string().nullish(),
  /** Structured win detail — meaningful when status === 'WON'. */
  winData: WinDataSchema.optional(),
  /** Structured loss detail — meaningful when status === 'LOST'. */
  lossData: LossDataSchema.optional(),
  /** Contract jurisdiction (gates debrief vs. state records request). */
  jurisdiction: JurisdictionSchema.optional(),
  /** Full state name — required when jurisdiction === 'STATE'. */
  state: z.string().nullish(),
  /**
   * ISO datetime the terminal outcome was **recorded** — i.e. when someone moved
   * the opportunity to a terminal status, not when the agency acted.
   *
   * `opportunity-status.ts` stamps this with `now` on every terminal transition
   * (84 of the 85 populated values in dev are such stamps). It is therefore NOT
   * evidence of an award date, and `resolveAwardDate` ranks it accordingly. For
   * the date an agency actually stated, see `agencyStatedAwardDate`.
   */
  outcomeDate: z.string().datetime().nullish(),
  /**
   * The award date an AGENCY stated, in its own words, as a date-only value.
   *
   * Separate from `outcomeDate` because the two answer different questions and
   * conflating them produced a real 132-day error: the inbound-mail pipeline wrote
   * an agency-stated 2026-01-29 to `outcomeDate`, where it was outranked on read by
   * a `lossData.lossDate` click timestamp of 2026-06-10 — and the letter would have
   * asserted the later date as verified. This field is the only one that may carry
   * `RECORDED_AWARD` provenance from mail, so it must never be written from a
   * receipt date or a UI interaction. See `awardDateFromMail`, which only returns
   * `RECORDED_AWARD` when the message itself stated a date.
   *
   * Date-only (`YYYY-MM-DD`) on purpose: an agency states a day, not an instant,
   * and inventing a time would imply precision we do not have.
   */
  agencyStatedAwardDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date-only YYYY-MM-DD value')
    .nullish(),
  /** User who recorded the outcome. */
  outcomeSetBy: z.string().nullish(),
  // Audit fields
  createdAt:     z.string().datetime().optional(),
  updatedAt:     z.string().datetime().optional(),
  createdBy:     z.string().optional(),
  updatedBy:     z.string().optional(),
  createdByName: z.string().optional(),
  updatedByName: z.string().optional(),
  // AWS Partner Central sync
  /** APN opportunity ID returned by Partner Central API (null = not synced) */
  apnOpportunityId: z.string().nullish(),
  /** Last APN sync error message (null = no error) */
  apnSyncError:     z.string().nullish(),
  // Assignment fields
  /** User ID of the person assigned to work on this opportunity */
  assigneeId:       z.string().nullish(),
  /** Display name of the assignee (stored at assignment time) */
  assigneeName:     z.string().nullish(),
  /** User ID of the person who made the assignment */
  assignedByUserId: z.string().nullish(),
  /** Display name of the person who made the assignment */
  assignedByName:   z.string().nullish(),
  /** ISO datetime when the opportunity was emitted to EventBridge (idempotency marker) */
  eventBridgeEmittedAt: z.string().datetime().nullish(),
  /** URL of the deployed POC site (set by DevelopmentPlatform callback) */
  pocUrl: z.string().url().nullish(),
  /** ISO datetime when the POC was deployed */
  pocDeployedAt: z.string().datetime().nullish(),
  /**
   * POC generation lifecycle state, driven by DevelopmentPlatform callbacks.
   * 'generating' set on emit; 'succeeded' on POCDeploymentComplete;
   * 'failed' on POCDeploymentFailed (unless a live pocUrl already exists —
   * Complete wins). Absent on records created before POC generation existed.
   */
  pocGenState: z.enum(['generating', 'succeeded', 'failed']).nullish(),
  /** Free-text failure reason from POCDeploymentFailed (display only — never parse) */
  pocFailureReason: z.string().nullish(),
  /** ISO datetime the POC generation failed */
  pocFailedAt: z.string().datetime().nullish(),
  /** Compliance check IDs that admins have marked as ignored */
  ignoredComplianceCheckIds: z.array(z.string()).optional(),
  /** Place of performance (city, state, country) */
  placeOfPerformance: z.string().nullish(),
  /** Primary point-of-contact email */
  contactEmail: z.string().nullish(),
  /** Primary point-of-contact name */
  contactName: z.string().nullish(),
  /** Link to the original source listing (e.g. SAM.gov or state portal URL) */
  sourceUrl: z.string().nullish(),
  /** HigherGov unique opportunity key (used for dedup and re-fetch) */
  higherGovOppKey: z.string().nullish(),
  /**
   * HigherGov agency key for the issuing office. Present in the import payload
   * and previously discarded; retained so the FOIA recipient resolver can walk
   * the agency hierarchy — HigherGov stores a leaf office ("NPS Midwest Region")
   * that is not itself a FOIA component, but its parent department is.
   */
  higherGovAgencyKey: z.string().nullish(),
  /** HigherGov AI-generated summary — proprietary enrichment */
  higherGovAiSummary: z.string().nullish(),
  /** Decision/award date — when the awarding agency will announce the winner */
  decisionDateIso: flexibleDateSchema.nullish(),
  /** Contract start / period-of-performance start date */
  contractStartDateIso: flexibleDateSchema.nullish(),
  /** Whether offshore delivery is allowed. AI-detected during brief analysis; user-editable. */
  deliveryLocationConstraint: DeliveryLocationConstraintSchema.nullish(),
  /** How the constraint was set — drives the "auto-detected (editable)" UI hint. */
  deliveryConstraintSource: z.enum(['AI_DETECTED', 'USER_SET']).nullish(),
  /** Short rationale for the detected constraint (quote/keyword from solicitation). */
  deliveryConstraintRationale: z.string().max(500).nullish(),

  // ── Notary detection rollup (u2-notary-backend-wiring) ──
  /**
   * Opportunity-level notary rollup, computed by mark-forms-ready once every
   * required form reaches a terminal state. Absent/null until then. `.nullish()`
   * (optional, like the sibling deliveryConstraintSource) so existing opportunity
   * records and construction sites read cleanly with no migration.
   */
  notarySummary: NotarySummarySchema.nullish(),
  /**
   * Provenance of notarySummary. AI_DETECTED is recomputed by the rollup on every
   * terminal event; a USER_SET summary is never overwritten (enforced by the
   * rollup's atomic conditional write, BR10.2). Absent is treated as AI_DETECTED
   * by the guard condition.
   */
  notarySummarySource: NotaryClassificationSourceSchema.nullish(),
  /**
   * Opportunity-level store of UNMAPPED solicitation-instruction notary triggers —
   * generic body mentions ("all certifications must be notarized") that the body
   * scan could not attribute to a specific form (BR10.3). Persisted here at scan
   * time so a generic trigger survives the async gap on a MIXED opportunity (inline
   * forms READY, PDF forms still pending): the FINAL rollup — whichever
   * markFormsReadyIfAllDone call fires last, including the Textract callback with no
   * passed-in triggers — reads this store and folds it into the summary counts, so
   * the mention is never silently dropped (NFR1 zero-miss). AI-detected evidence,
   * recomputed wholesale (merge/union, deduped by natural key) on every re-scan.
   * `.nullish()` (like the sibling notarySummarySource) so legacy records and
   * construction sites read cleanly with no migration.
   */
  notaryUnmappedTriggers: z.array(NotaryRequirementSchema).nullish(),

  // ── FOIA automation ──
  /**
   * Denormalized mirror of the FOIA automation state, for badges in list and
   * board views. The authoritative record is the FOIA_AUTOMATION item; this is
   * written only by the backend and re-synced by the scanner on every pass.
   * Omitted from OpportunityUpdateRequestSchema so clients cannot patch it.
   */
  foiaAutomationState: FoiaAutomationStateSchema.nullish(),
  /**
   * Explicit FOIA-office email for this solicitation. Tier 1 of the recipient
   * fallback chain, and deliberately separate from `contactEmail` — the
   * contracting officer is frequently not the FOIA office, and overloading one
   * field would mean editing the CO contact silently redirects legal mail.
   */
  foiaContactEmail: z.string().nullish(),
  /** Mailing address for the FOIA office, used in the letter header. */
  foiaContactAddress: z.string().nullish(),
  /** Name or office title of the FOIA contact. */
  foiaContactName: z.string().nullish(),
});

export type OpportunityItem = z.infer<typeof OpportunityItemSchema>;

// ─── DB record (domain entity + single-table keys) ──────────────────────────────

export const OpportunityDBItemSchema = OpportunityItemSchema.extend({
  [PK_NAME]: z.string(), // Partition Key (OPPORTUNITY_PK)
  [SK_NAME]: z.string(), // Sort Key (`${orgId}#${projectId}#${oppId}`)
});

export type OpportunityDBItem = z.infer<typeof OpportunityDBItemSchema>;

// ─── Create request ─────────────────────────────────────────────────────────────

/**
 * Incoming request body for creating an opportunity.
 * Server-managed fields (oppId, audit, sync/assignment markers) are omitted —
 * they're generated by the create helper or set by later workflows.
 * orgId/projectId/status remain optional, exactly as on the item.
 */
export const OpportunityCreateRequestSchema = OpportunityItemSchema.omit({
  oppId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  createdByName: true,
  updatedByName: true,
  eventBridgeEmittedAt: true,
  apnOpportunityId: true,
  apnSyncError: true,
  pocUrl: true,
  pocDeployedAt: true,
  pocGenState: true,
  pocFailureReason: true,
  pocFailedAt: true,
  assigneeId: true,
  assigneeName: true,
  assignedByUserId: true,
  assignedByName: true,
});

export type OpportunityCreateRequest = z.infer<typeof OpportunityCreateRequestSchema>;

// ─── Update request ─────────────────────────────────────────────────────────────

/**
 * Partial patch for updating an opportunity. Identifiers are not patchable.
 *
 * `foiaAutomationState` is also omitted: it mirrors the FOIA_AUTOMATION record
 * and is written only by the backend. Leaving it patchable would let any client
 * with `opportunity:edit` fake "FOIA sent" on an opportunity.
 */
export const OpportunityUpdateRequestSchema = OpportunityItemSchema
  .partial()
  .omit({ orgId: true, projectId: true, oppId: true, foiaAutomationState: true });

export type OpportunityUpdateRequest = z.infer<typeof OpportunityUpdateRequestSchema>;

// ─── Lightweight list/card shape ────────────────────────────────────────────────

export const OpportunityListItemSchema = z.object({
  id:        z.string(),
  oppId:     z.string().optional(),
  orgId:     z.string().optional(),
  projectId: z.string().optional(),
  source:    OpportunitySourceSchema,
  title:     z.string(),
  status:    OpportunityStatusSchema.optional(),
  approvalStatus: OpportunityApprovalStatusSchema.optional(),
  pipelineStage: RfpPipelineStageSchema.optional(),
  active:    z.boolean().optional(),
  organizationName:     z.string().nullish(),
  noticeId:             z.string().nullish(),
  solicitationNumber:   z.string().nullish(),
  type:                 z.string().nullish(),
  naicsCode:            z.string().nullish(),
  setAside:             z.string().nullish(),
  description:          z.string().nullish(),
  responseDeadlineIso:  z.string().nullish(),
  postedDateIso:        z.string().nullish(),
  decisionDateIso:      z.string().nullish(),
  contractStartDateIso: z.string().nullish(),
  createdAt:            z.string().nullish(),
  assigneeId:           z.string().nullish(),
  assigneeName:         z.string().nullish(),
  /** Drives the FOIA badge in list/board views. */
  foiaAutomationState:  FoiaAutomationStateSchema.nullish(),
  /**
   * Mirrored from OpportunityItem so the list/card notary badge can read it — a
   * field added only to the full item would never reach the card projection.
   */
  notarySummary:        NotarySummarySchema.nullable().default(null),
});

export type OpportunityListItem = z.infer<typeof OpportunityListItemSchema>;

// ─── Query DTO ────────────────────────────────────────────────────────────────

export const OpportunityQuerySchema = z.object({
  orgId:     z.string().nullable(),
  projectId: z.string().min(1),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isFinite(v) && v > 0 && v <= 200), {
      message: 'limit must be a number between 1 and 200',
    })
    .optional(),
  nextToken: z.string().optional(),
});

export type OpportunityQuery = z.infer<typeof OpportunityQuerySchema>;

// ─── Opportunity Assignment ───────────────────────────────────────────────────

/**
 * Schema for assigning an opportunity to a user.
 * The assignee must have access to the project.
 */
export const AssignOpportunityDTOSchema = z.object({
  orgId:      z.string().min(1),
  projectId:  z.string().min(1),
  oppId:      z.string().min(1),
  /** User ID to assign. Pass null to unassign. */
  assigneeId: z.string().min(1).nullable(),
});

export type AssignOpportunityDTO = z.infer<typeof AssignOpportunityDTOSchema>;
