import { z } from 'zod';
import { ChatSourceCitationSchema } from './opportunity-assistant';

/**
 * AI Compliance Review — reviews a whole submission package (RFP documents +
 * required forms) against the solicitation documents, in two modes:
 *   - "Full review": async whole-package pass (SQS worker, no 29s limit)
 *   - "Chat": synchronous per-section / per-question Q&A
 *
 * Both modes emit structured Findings. Findings are per-run (latest-run
 * authoritative, replaced on re-run). User Decisions (dismiss/resolve) persist
 * separately, keyed by a stable fingerprint so they survive re-runs.
 */

// ─── Severity & Issue Type ──────────────────────────────────────────────────

export const ComplianceFindingSeveritySchema = z.enum([
  'critical',
  'major',
  'minor',
  'info',
]);
export type ComplianceFindingSeverity = z.infer<typeof ComplianceFindingSeveritySchema>;

export const ComplianceIssueTypeSchema = z.enum([
  'MISSING_REQUIREMENT', // Solicitation requirement not addressed anywhere
  'MISSING_FORM',        // A required form is absent from the package
  'INCORRECT_ANSWER',    // Content is factually wrong / contradicts solicitation
  'POOR_ANSWER',         // Content is weak, vague, or non-responsive
  'FORMAT_ISSUE',        // Format/page-limit/naming problem
  'INCONSISTENCY',       // Values disagree across documents (cost, dates, etc.)
  'FACTUAL_INACCURACY',  // A package claim contradicts an internal source of truth (C1, C3, C4)
  'UNVERIFIED_CLAIM',    // A claimed cert is absent / unverified / expired (C2)
  'NDA_DISCLOSURE_LEAK', // Package discloses a client name that must be withheld (C5)
  'SOLUTION_PLAN_MISMATCH', // A package claim contradicts the latest solution plan (C6)
  'OTHER',
]);
export type ComplianceIssueType = z.infer<typeof ComplianceIssueTypeSchema>;

// ─── Target Kind ────────────────────────────────────────────────────────────

/** Which kind of package artifact a finding points at. */
export const ComplianceTargetKindSchema = z.enum([
  'RFP_DOCUMENT',       // HTML-backed RFP document
  'XLSX_QUESTIONNAIRE', // Cell-based XLSX questionnaire
  'XLSX_FORM',          // Field-based XLSX required form
  'PDF_FORM',           // Field-based PDF required form
  'FORM_MISSING',       // A form that should exist but does not (no target to open)
]);
export type ComplianceTargetKind = z.infer<typeof ComplianceTargetKindSchema>;

// ─── Finding Anchor (discriminated union) ───────────────────────────────────

/**
 * A machine-addressable pointer to the exact "spot" a finding refers to.
 * Kind depends on the target editor:
 *   - heading → HTML RFP document (matched against <h1/h2/h3> text)
 *   - cell    → XLSX questionnaire (sheet + row/col)
 *   - field   → XLSX form / PDF form (fieldId from the detected-form inventory)
 */
export const FindingAnchorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('heading'),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('cell'),
    sheet: z.string(),
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('field'),
    fieldId: z.string().min(1),
  }),
]);
export type FindingAnchor = z.infer<typeof FindingAnchorSchema>;

// ─── Finding ────────────────────────────────────────────────────────────────

export const ComplianceFindingSchema = z.object({
  /** Model-generated id — kept as a plain string (not .uuid()) so a stray id never fails response parsing. */
  findingId: z.string().min(1),
  /** Server-computed stable identity: documentId + anchor + issueType + normalized(snippet). */
  fingerprint: z.string().min(1),
  /** Target artifact this finding points at. */
  targetKind: ComplianceTargetKindSchema,
  /** RFP document / required form id (absent for FORM_MISSING). */
  documentId: z.string().optional(),
  documentTitle: z.string().optional(),
  /** Machine-addressable spot. Absent when the model couldn't localize it. */
  anchor: FindingAnchorSchema.optional(),
  /** Verbatim excerpt from the artifact — the universal fallback for "search in document". */
  snippet: z.string().optional(),
  issueType: ComplianceIssueTypeSchema,
  severity: ComplianceFindingSeveritySchema,
  title: z.string().min(1),
  description: z.string(),
  suggestion: z.string().optional(),
  /** Solicitation excerpts that justify the finding. */
  solicitationRefs: z.array(ChatSourceCitationSchema).optional(),
  /**
   * Set by server-side validation: true when the anchor was verified against
   * the real inventory and the snippet is a genuine substring. When false, the
   * UI degrades to snippet-search / show-and-read instead of a broken jump.
   */
  anchorValid: z.boolean().default(false),
});
export type ComplianceFinding = z.infer<typeof ComplianceFindingSchema>;

// ─── Finding Decision (persisted, survives re-runs by fingerprint) ──────────

export const FindingDecisionStateSchema = z.enum(['dismissed', 'resolved']);
export type FindingDecisionState = z.infer<typeof FindingDecisionStateSchema>;

export const FindingDecisionSchema = z.object({
  fingerprint: z.string().min(1),
  state: FindingDecisionStateSchema,
  decidedBy: z.string().optional(),
  decidedByName: z.string().optional(),
  decidedAt: z.string().datetime(),
  note: z.string().max(1000).optional(),
});
export type FindingDecision = z.infer<typeof FindingDecisionSchema>;

// ─── Review Run ─────────────────────────────────────────────────────────────

export const ComplianceReviewRunStatusSchema = z.enum(['RUNNING', 'READY', 'FAILED']);
export type ComplianceReviewRunStatus = z.infer<typeof ComplianceReviewRunStatusSchema>;

export const ComplianceReviewRunTriggerSchema = z.enum(['FULL', 'CHAT']);
export type ComplianceReviewRunTrigger = z.infer<typeof ComplianceReviewRunTriggerSchema>;

export const ComplianceReviewRunSchema = z.object({
  reviewId: z.string().uuid(),
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  status: ComplianceReviewRunStatusSchema,
  trigger: ComplianceReviewRunTriggerSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  /** Snapshot of doc/form version ids reviewed (documentId → version). Used for staleness detection. */
  snapshotVersionIds: z.record(z.string(), z.string()).default({}),
  findings: z.array(ComplianceFindingSchema).default([]),
  /** Set when status = FAILED. */
  error: z.string().optional(),
});
export type ComplianceReviewRun = z.infer<typeof ComplianceReviewRunSchema>;

// ─── Chat ───────────────────────────────────────────────────────────────────

export const ComplianceReviewMessageRoleSchema = z.enum(['user', 'assistant']);
export type ComplianceReviewMessageRole = z.infer<typeof ComplianceReviewMessageRoleSchema>;

export const ComplianceReviewMessageSchema = z.object({
  messageId: z.string().uuid(),
  oppId: z.string().min(1),
  role: ComplianceReviewMessageRoleSchema,
  content: z.string(),
  /** Findings produced by an assistant turn (chat can surface findings too). */
  findings: z.array(ComplianceFindingSchema).optional(),
  /**
   * Set on an assistant turn that kicked off a cross-package EDIT (unified chat):
   * the proposal run to poll + render inline. Absent for pure review turns.
   */
  editRunId: z.string().optional(),
  userId: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type ComplianceReviewMessage = z.infer<typeof ComplianceReviewMessageSchema>;

// ─── API Request/Response Schemas ───────────────────────────────────────────

export const ComplianceReviewChatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000, 'Message too long'),
});
export type ComplianceReviewChatRequest = z.infer<typeof ComplianceReviewChatRequestSchema>;

export const ComplianceReviewChatResponseSchema = z.object({
  answer: z.string(),
  findings: z.array(ComplianceFindingSchema),
  messageId: z.string().uuid(),
});
export type ComplianceReviewChatResponse = z.infer<typeof ComplianceReviewChatResponseSchema>;

export const ComplianceReviewHistoryResponseSchema = z.object({
  messages: z.array(ComplianceReviewMessageSchema),
});
export type ComplianceReviewHistoryResponse = z.infer<typeof ComplianceReviewHistoryResponseSchema>;

export const TriggerReviewResponseSchema = z.object({
  reviewId: z.string().uuid(),
  status: ComplianceReviewRunStatusSchema,
});
export type TriggerReviewResponse = z.infer<typeof TriggerReviewResponseSchema>;

/** Latest run plus persisted decisions plus a staleness flag (snapshot vs current versions). */
export const GetReviewResponseSchema = z.object({
  run: ComplianceReviewRunSchema.nullable(),
  decisions: z.array(FindingDecisionSchema),
  stale: z.boolean(),
});
export type GetReviewResponse = z.infer<typeof GetReviewResponseSchema>;

export const UpdateDecisionRequestSchema = z.object({
  fingerprint: z.string().min(1),
  /** Null clears an existing decision (un-dismiss / un-resolve). */
  state: FindingDecisionStateSchema.nullable(),
  note: z.string().max(1000).optional(),
});
export type UpdateDecisionRequest = z.infer<typeof UpdateDecisionRequestSchema>;
