/**
 * solution-plan.ts
 *
 * Solution Plan ("Source of Truth") — the approved technical/delivery plan for
 * an opportunity, produced by the two-agent grilling loop and injected into
 * document generation as the authoritative context.
 *
 * One plan per opportunity. The HTML body lives in S3 (`contentKey`); DynamoDB
 * holds only the metadata record.
 */

import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';
import { RFP_DOCUMENT_TYPES } from './rfp-document';

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * Pure lifecycle status (ADR-3). Freshness is NOT a status — it is the
 * orthogonal `isStale` flag, so a stale plan stays READY and keeps the
 * generation gate open.
 *
 *   GRILLING       — two-agent interview loop in progress
 *   GENERATING_SOT — interview done, synthesis call in progress
 *   READY          — plan synthesized and available (possibly stale)
 *   FAILED         — grilling or synthesis failed (see `error`)
 */
export const SolutionPlanStatusSchema = z.enum([
  'GRILLING',
  'GENERATING_SOT',
  'READY',
  'FAILED',
]);

export type SolutionPlanStatus = z.infer<typeof SolutionPlanStatusSchema>;

/** Human-readable labels for each solution plan status */
export const SOLUTION_PLAN_STATUS_LABELS: Record<SolutionPlanStatus, string> = {
  GRILLING: 'Interview in Progress',
  GENERATING_SOT: 'Generating Plan',
  READY: 'Ready',
  FAILED: 'Failed',
};

// ─── Key ────────────────────────────────────────────────────────────────────────

/**
 * The identifier triple that uniquely addresses a plan (one plan per
 * opportunity). Travels together everywhere — SK builders, lookups, S3 keys —
 * so it is a single named type rather than three loose parameters.
 */
export const SolutionPlanKeySchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  opportunityId: z.string().min(1, 'Opportunity ID is required'),
});

export type SolutionPlanKey = z.infer<typeof SolutionPlanKeySchema>;

// ─── Create request ─────────────────────────────────────────────────────────────

/**
 * Incoming request body for initializing (or re-initializing) a solution plan —
 * exactly the key triple. Everything else — id, runId, status, version — is
 * server-managed.
 */
export const SolutionPlanCreateRequestSchema = SolutionPlanKeySchema;

export type SolutionPlanCreateRequest = z.infer<typeof SolutionPlanCreateRequestSchema>;

/**
 * POST body for `init-solution-plan` — the key triple plus an explicit restart
 * intent. Re-initializing a plan that is mid-run (GRILLING/GENERATING_SOT)
 * requires `restart: true`; a silent re-init is refused with 409 (ADR-5).
 */
export const SolutionPlanInitRequestSchema = SolutionPlanKeySchema.extend({
  restart: z.boolean().optional(),
});

export type SolutionPlanInitRequest = z.infer<typeof SolutionPlanInitRequestSchema>;

// ─── Update request ─────────────────────────────────────────────────────────────

/**
 * Incoming PATCH body for editing a READY plan's content.
 * Identifiers are not patchable; the only user-mutable field is the HTML body
 * (versioning, `isUserEdited`, and `isStale` clearing are server-managed).
 * Deliberately not derived from the create request — every create field is an
 * identifier, so a `.partial()` of it would be empty.
 */
export const SolutionPlanUpdateRequestSchema = z.object({
  htmlContent: z.string().min(1, 'Content is required'),
});

export type SolutionPlanUpdateRequest = z.infer<typeof SolutionPlanUpdateRequestSchema>;

// ─── Error codes ────────────────────────────────────────────────────────────────

/**
 * Machine-readable `code` values carried in solution-plan error response
 * bodies (409s from update/init and the generation gate). Frontends branch
 * on these instead of matching message strings.
 */
export const SolutionPlanErrorCodeSchema = z.enum([
  'SOLUTION_PLAN_NOT_READY',
  'SOLUTION_PLAN_CONFLICT',
  'SOLUTION_PLAN_RUN_IN_PROGRESS',
  'SOLUTION_PLAN_REQUIRED',
]);

export type SolutionPlanErrorCode = z.infer<typeof SolutionPlanErrorCodeSchema>;

// ─── Generation gate ────────────────────────────────────────────────────────────

/**
 * Document types that never require a Solution Plan (Q&A-style exports).
 * Shared by the server-side generation gate (T9) and the frontend gating UI
 * (T12) so both always agree on what is exempt.
 */
export const SOLUTION_PLAN_GATE_EXEMPT_DOCUMENT_TYPES = [
  'CLARIFYING_QUESTIONS',
  'QUESTIONS_AND_ANSWERS',
  'QUESTIONNAIRE',
] as const satisfies readonly (keyof typeof RFP_DOCUMENT_TYPES)[];

const GATE_EXEMPT_TYPES: ReadonlySet<string> = new Set(
  SOLUTION_PLAN_GATE_EXEMPT_DOCUMENT_TYPES,
);

/** True when the document type requires a READY Solution Plan (custom types are gated). */
export const isSolutionPlanGatedDocumentType = (documentType: string): boolean =>
  !GATE_EXEMPT_TYPES.has(documentType);

// ─── Item (pure domain entity) ──────────────────────────────────────────────────

/**
 * Solution plan domain entity returned by the API.
 * Pure domain shape — does NOT include DynamoDB keys.
 */
export const SolutionPlanItemSchema = SolutionPlanCreateRequestSchema.extend({
  id: z.string().min(1),
  status: SolutionPlanStatusSchema,
  /**
   * Freshness flag, orthogonal to `status` (ADR-3). Set when an input the plan
   * was built from changes (exec brief regenerated, new solicitation doc);
   * cleared on save/regenerate. A stale plan is still READY.
   */
  isStale: z.boolean().default(false),
  /** Why the plan was marked stale — shown in the staleness warning banner. */
  staleReason: z.string().optional(),
  /**
   * Identifier of the current grilling run. Workers no-op when a queued
   * message's runId no longer matches (zombie-round protection, ADR-5).
   */
  runId: z.string().min(1),
  /** S3 key of the synthesized HTML body. Absent until first synthesis. */
  contentKey: z.string().optional(),
  /**
   * Content version, bumped on every synthesis and user edit.
   * Monotonic across regenerations — never reset (ADR-11).
   */
  version: z.number().int().nonnegative(),
  /** True once a user has manually edited the plan (regenerate warns & wipes edits). */
  isUserEdited: z.boolean().default(false),
  /** User who last manually edited the plan. */
  editedBy: z.string().optional(),
  /** Number of grilling rounds completed for the current run. */
  grillingRounds: z.number().int().nonnegative().optional(),
  /** ISO datetime the grilling interview finished (synthesis started). */
  grillingCompletedAt: z.string().datetime().optional(),
  /** Failure message when status is FAILED. */
  error: z.string().optional(),
  // Audit fields
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  createdByName: z.string().optional(),
  updatedByName: z.string().optional(),
});

export type SolutionPlanItem = z.infer<typeof SolutionPlanItemSchema>;

/**
 * Fields a status transition may patch alongside `status` (e.g. `contentKey` +
 * `version` on READY, `error` on FAILED). Identifiers and `status` itself are
 * excluded — the transition helper sets `status` explicitly.
 */
export const SolutionPlanStatusPatchSchema = SolutionPlanItemSchema.pick({
  isStale: true,
  staleReason: true,
  contentKey: true,
  version: true,
  isUserEdited: true,
  editedBy: true,
  grillingRounds: true,
  grillingCompletedAt: true,
  error: true,
  updatedBy: true,
  updatedByName: true,
}).partial();

export type SolutionPlanStatusPatch = z.infer<typeof SolutionPlanStatusPatchSchema>;

// ─── DB record (domain entity + single-table keys) ──────────────────────────────

export const SolutionPlanDBItemSchema = SolutionPlanItemSchema.extend({
  [PK_NAME]: z.string(), // Partition Key (SOLUTION_PLAN_PK)
  [SK_NAME]: z.string(), // Sort Key (`${orgId}#${projectId}#${opportunityId}`)
});

export type SolutionPlanDBItem = z.infer<typeof SolutionPlanDBItemSchema>;

// ─── Lightweight list/card shape ────────────────────────────────────────────────

/**
 * Lightweight projection for panel/status views — what `SolutionPlanPanel`
 * and the generation gates actually read.
 */
export const SolutionPlanListItemSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  opportunityId: z.string(),
  status: SolutionPlanStatusSchema,
  isStale: z.boolean(),
  staleReason: z.string().optional(),
  version: z.number().int().nonnegative(),
  isUserEdited: z.boolean().optional(),
  grillingCompletedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type SolutionPlanListItem = z.infer<typeof SolutionPlanListItemSchema>;

// ─── Grilling messages (interview transcript) ───────────────────────────────────

/**
 * Who authored a transcript message:
 *   GRILLER   — the questioning agent
 *   TECH_LEAD — the answering agent (may use tools)
 *   SYSTEM    — lifecycle markers (round boundaries, termination, errors)
 */
export const GrillingMessageRoleSchema = z.enum(['GRILLER', 'TECH_LEAD', 'SYSTEM']);

export type GrillingMessageRole = z.infer<typeof GrillingMessageRoleSchema>;

/** Compact record of one tool invocation made by the Tech Lead during a turn. */
export const GrillingToolCallSummarySchema = z.object({
  toolName: z.string().min(1),
  /** Short human-readable summary of the tool input/result — not the full payload. */
  summary: z.string().optional(),
});

export type GrillingToolCallSummary = z.infer<typeof GrillingToolCallSummarySchema>;

/**
 * One message of the grilling interview transcript.
 * Append-only — created by the worker, never via a client request, so there is
 * no Create/Update request pair for this entity.
 */
export const GrillingMessageItemSchema = z.object({
  id: z.string().min(1),
  solutionPlanId: z.string().min(1),
  /** Run the message belongs to — used for idempotency and zombie-round checks (ADR-5). */
  runId: z.string().min(1),
  /** 1-based interview round number. */
  round: z.number().int().min(1),
  role: GrillingMessageRoleSchema,
  content: z.string().min(1),
  /** Summaries of tool calls made during this turn (Tech Lead only). */
  toolCalls: z.array(GrillingToolCallSummarySchema).optional(),
  createdAt: z.string().datetime().optional(),
});

export type GrillingMessageItem = z.infer<typeof GrillingMessageItemSchema>;

export const GrillingMessageDBItemSchema = GrillingMessageItemSchema.extend({
  [PK_NAME]: z.string(), // Partition Key (GRILLING_MESSAGE_PK)
  [SK_NAME]: z.string(), // Sort Key (`${solutionPlanId}#${round:3pad}#${ts}#${messageId}`)
});

export type GrillingMessageDBItem = z.infer<typeof GrillingMessageDBItemSchema>;

/**
 * Lightweight projection for the live transcript feed — what
 * `GrillingTranscriptView` actually renders per message.
 */
export const GrillingMessageListItemSchema = z.object({
  id: z.string(),
  round: z.number(),
  role: GrillingMessageRoleSchema,
  content: z.string(),
  toolCalls: z.array(GrillingToolCallSummarySchema).optional(),
  createdAt: z.string().optional(),
});

export type GrillingMessageListItem = z.infer<typeof GrillingMessageListItemSchema>;

// ─── API Response Schemas ───────────────────────────────────────────────────────

/** 202 body of POST /solution-plan/init. */
export const SolutionPlanInitResponseSchema = z.object({
  ok: z.boolean(),
  solutionPlanId: z.string(),
  runId: z.string(),
  status: SolutionPlanStatusSchema,
  version: z.number().int().nonnegative(),
  /** True when the init replaced an existing plan record. */
  regenerated: z.boolean(),
  /** Number of transcript messages wiped from the superseded run. */
  wipedMessages: z.number().int().nonnegative(),
});

export type SolutionPlanInitResponse = z.infer<typeof SolutionPlanInitResponseSchema>;

/** 200 body of GET /solution-plan/get and PATCH /solution-plan/update. */
export const SolutionPlanResponseSchema = z.object({
  ok: z.boolean(),
  plan: SolutionPlanItemSchema,
});

export type SolutionPlanResponse = z.infer<typeof SolutionPlanResponseSchema>;

/** 200 body of GET /solution-plan/transcript. */
export const SolutionPlanTranscriptResponseSchema = z.object({
  ok: z.boolean(),
  solutionPlanId: z.string(),
  runId: z.string(),
  status: SolutionPlanStatusSchema,
  messages: z.array(GrillingMessageItemSchema),
});

export type SolutionPlanTranscriptResponse = z.infer<typeof SolutionPlanTranscriptResponseSchema>;

/** 200 body of GET /solution-plan/html-content. */
export const SolutionPlanHtmlContentResponseSchema = z.object({
  ok: z.boolean(),
  html: z.string(),
  contentKey: z.string(),
  version: z.number().int().nonnegative(),
  isStale: z.boolean(),
  isUserEdited: z.boolean(),
});

export type SolutionPlanHtmlContentResponse = z.infer<typeof SolutionPlanHtmlContentResponseSchema>;
