import { z } from 'zod';

import { FindingAnchorSchema, ComplianceFindingSchema } from './compliance-review'; // reuse the anchor + finding shapes

/**
 * Cross-Package AI Editing ("Mass Edit").
 *
 * A propose-then-confirm flow that carries a single edit across every RFP
 * document and required form in a package:
 *   - a sync chat turn (Haiku) routes intent (answer a question vs. start an edit)
 *   - an async worker (Sonnet, SQS) scans the whole package and drafts every
 *     before→after as a `ProposedEdit`
 *   - a sync, LLM-free apply performs guarded per-target writes (re-verify
 *     `before`; skip+report if stale/ambiguous)
 *
 * Mirrors the ComplianceReviewRun lifecycle (RUNNING/READY/FAILED → here
 * PROPOSING/PROPOSED/FAILED). ids/timestamps are plain strings (not `.uuid()`/
 * `.datetime()`) so a stray value never fails response parsing.
 */

// ─── Edit target ──────────────────────────────────────────────────────────────
// An edit points at either an HTML RFP document or a required-form field.
export const EditTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('RFP_DOCUMENT'),
    documentId: z.string(),
    documentTitle: z.string().optional(),
    // Where in the document (reuse the compliance heading anchor for localization).
    anchor: FindingAnchorSchema.optional(),
  }),
  z.object({
    kind: z.literal('FORM'),
    formId: z.string(),
    formTitle: z.string().optional(),
    fieldId: z.string(), // exact fieldId from get_form_fields
    fieldLabel: z.string().optional(),
  }),
  z.object({
    // A single cell of a file-based XLSX questionnaire. Coordinates match the
    // review anchor + the editor's `data-highlight-cell` (0-based SheetJS r/c);
    // `ref` is the A1 address used to read/write the cell in the workbook.
    kind: z.literal('QUESTIONNAIRE'),
    documentId: z.string(),
    documentTitle: z.string().optional(),
    sheetName: z.string(),
    row: z.number().int().min(0),
    col: z.number().int().min(0),
    ref: z.string(),
  }),
]);
export type EditTarget = z.infer<typeof EditTargetSchema>;

// ─── A single proposed edit (drafted by the async worker, applied on confirm) ──
export const ProposedEditSchema = z.object({
  editId: z.string(), // worker-generated unique id
  target: EditTargetSchema,
  before: z.string(), // VERBATIM current text/value (the apply guard checks this)
  after: z.string(), // the replacement
  rationale: z.string(), // one-line "why", shown on the diff card
  // Stage-1 advisory: a FORM edit shown for visibility only when forms are out of
  // scope for a given run. With forms in Stage 1 this is normally false, but the
  // flag stays so a future read-only mode is expressible.
  advisoryOnly: z.boolean().default(false),
});
export type ProposedEdit = z.infer<typeof ProposedEditSchema>;

// ─── Proposal run (async lifecycle — mirrors ComplianceReviewRun) ─────────────
export const PackageEditRunStatusSchema = z.enum(['PROPOSING', 'PROPOSED', 'FAILED']);
export type PackageEditRunStatus = z.infer<typeof PackageEditRunStatusSchema>;

export const PackageEditRunSchema = z.object({
  runId: z.string(),
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  status: PackageEditRunStatusSchema,
  instruction: z.string(), // the user's edit request that seeded this run
  proposals: z.array(ProposedEditSchema).default([]),
  // Human-readable outcome of the scan, shown when there are no proposals (e.g.
  // "The value 'x@y.com' wasn't found in the package"). Distinguishes a genuine
  // no-op from "nothing matched" so the UI never says a misleading "no changes needed".
  summary: z.string().optional(),
  // editIds that have been successfully applied from this run, so a re-poll /
  // "review remaining" only surfaces proposals not yet applied. Persisted by the
  // apply handler after each apply.
  appliedEditIds: z.array(z.string()).default([]),
  // docId/formId → version marker, for staleness detection (mirrors compliance snapshot).
  snapshotVersionIds: z.record(z.string(), z.string()).default({}),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  ttl: z.number().optional(), // epoch seconds; table TTL backstop
});
export type PackageEditRun = z.infer<typeof PackageEditRunSchema>;

// ─── Chat (unified surface reuses this; standalone panel also uses it) ────────
export const PackageEditChatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000, 'Message too long'),
});
export type PackageEditChatRequest = z.infer<typeof PackageEditChatRequestSchema>;

// A chat turn either answers (review intent) or kicks off a proposal run (edit intent).
export const PackageEditChatResponseSchema = z.object({
  messageId: z.string(),
  answer: z.string(), // human-readable reply either way
  intent: z.enum(['REVIEW', 'EDIT']),
  runId: z.string().optional(), // present when intent === 'EDIT' (poll GET /run)
  // On a REVIEW turn the unified chat surfaces findings inline, like the
  // compliance chat. Reuses the compliance finding shape.
  findings: z.array(ComplianceFindingSchema).default([]),
});
export type PackageEditChatResponse = z.infer<typeof PackageEditChatResponseSchema>;

// ─── Apply (confirmed; guarded; per-target result) ───────────────────────────
export const ApplyEditsRequestSchema = z.object({
  runId: z.string().min(1),
  editIds: z.array(z.string()).min(1, 'At least one edit must be selected'),
});
export type ApplyEditsRequest = z.infer<typeof ApplyEditsRequestSchema>;

export const EditApplyStatusSchema = z.enum(['applied', 'skipped-stale', 'failed']);
export type EditApplyStatus = z.infer<typeof EditApplyStatusSchema>;

export const EditApplyResultSchema = z.object({
  editId: z.string(),
  status: EditApplyStatusSchema,
  message: z.string().optional(),
  newVersionNumber: z.number().optional(), // for RFP_DOCUMENT and FORM (both versioned now)
});
export type EditApplyResult = z.infer<typeof EditApplyResultSchema>;

export const ApplyEditsResponseSchema = z.object({
  results: z.array(EditApplyResultSchema),
});
export type ApplyEditsResponse = z.infer<typeof ApplyEditsResponseSchema>;

// ─── Get run (poll) ──────────────────────────────────────────────────────────
export const GetPackageEditRunResponseSchema = z.object({
  run: PackageEditRunSchema.nullable(),
  /** True when the package changed since the run's snapshot (proposals may be stale). */
  stale: z.boolean().default(false),
});
export type GetPackageEditRunResponse = z.infer<typeof GetPackageEditRunResponseSchema>;
