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

// ─── Source enum ──────────────────────────────────────────────────────────────

export const OpportunitySourceSchema = z.enum(['SAM_GOV', 'DIBBS', 'HIGHER_GOV', 'MANUAL_UPLOAD']);
export type OpportunitySource = z.infer<typeof OpportunitySourceSchema>;

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
export const OpportunityStageSchema = z.enum([
  'IDENTIFIED',   // Opportunity found/imported, not yet analyzed
  'QUALIFYING',   // Brief generation in progress, evaluating bid/no-bid
  'PURSUING',     // GO decision made, actively working on proposal
  'SUBMITTED',    // Proposal submitted, awaiting award decision
  'WON',          // Contract awarded to us
  'LOST',         // Contract awarded to competitor
  'NO_BID',       // Decided not to pursue
  'WITHDRAWN',    // Withdrew from competition
]);

export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

/** Human-readable labels for each pipeline stage */
export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
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
export const OPPORTUNITY_STAGE_COLORS: Record<OpportunityStage, string> = {
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
export const ACTIVE_OPPORTUNITY_STAGES: OpportunityStage[] = [
  'IDENTIFIED',
  'QUALIFYING',
  'PURSUING',
  'SUBMITTED',
];

/** Terminal stages — no further action expected */
export const TERMINAL_OPPORTUNITY_STAGES: OpportunityStage[] = [
  'WON',
  'LOST',
  'NO_BID',
  'WITHDRAWN',
];

/** Stage transition history entry */
export const OpportunityStageTransitionSchema = z.object({
  from:      OpportunityStageSchema.nullable(),
  to:        OpportunityStageSchema,
  changedAt: z.string().datetime(),
  changedBy: z.string().min(1),  // userId or 'system'
  reason:    z.string().optional(),
  source:    z.enum(['MANUAL', 'BRIEF_SCORING', 'PROJECT_OUTCOME', 'SYSTEM']),
});

export type OpportunityStageTransition = z.infer<typeof OpportunityStageTransitionSchema>;

// ─── Stored opportunity item ──────────────────────────────────────────────────

export const OpportunityItemSchema = z.object({
  orgId:     z.string().optional(),
  projectId: z.string().optional(),
  oppId:     z.string().optional(),
  source:    OpportunitySourceSchema,
  id:        z.string().min(1),
  title:     z.string().min(1),
  type:      z.string().nullable(),
  postedDateIso:       z.string().datetime().nullable(),
  responseDeadlineIso: z.string().datetime().nullable(),
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
   * Pipeline stage — replaces the binary `active` flag.
   * Defaults to IDENTIFIED for new opportunities.
   * `active` is kept for backward compatibility but derived from stage.
   * Optional so existing code that creates OpportunityItem without stage still compiles.
   * The default 'IDENTIFIED' is applied at the DB/helper layer, not enforced here.
   */
  stage:               OpportunityStageSchema.optional(),
  /**
   * Kept for backward compatibility with existing DB records.
   * Derived from stage: active = stage is in ACTIVE_OPPORTUNITY_STAGES.
   * Do not set this directly — use stage instead.
   * @deprecated Use `stage` instead.
   */
  active:              z.boolean().optional(),
  /** History of stage transitions */
  stageHistory:        z.array(OpportunityStageTransitionSchema).optional(),
  baseAndAllOptionsValue: z.number().nonnegative().nullable(),
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
  /** HigherGov AI-generated summary — proprietary enrichment */
  higherGovAiSummary: z.string().nullish(),
});

export type OpportunityItem = z.infer<typeof OpportunityItemSchema>;

// ─── Stage update DTO ─────────────────────────────────────────────────────────

export const UpdateOpportunityStageSchema = z.object({
  projectId: z.string().min(1),
  oppId:     z.string().min(1),
  stage:     OpportunityStageSchema,
  reason:    z.string().optional(),
});

export type UpdateOpportunityStageDTO = z.infer<typeof UpdateOpportunityStageSchema>;

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
