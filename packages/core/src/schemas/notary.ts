import { z } from 'zod';

/**
 * Notary-detection value objects (u1-notary-core-engine).
 *
 * All six shapes below are TRANSIENT / EMBEDDED value objects — none is a
 * persisted record with its own DynamoDB key, so per the confirmed functional
 * design they are single Zod schemas + inferred types (NOT the 5-type
 * CreateRequest/DBItem stored-entity pattern). `NotaryTextSegment` and
 * `NotaryCandidate` never cross a persistence or API boundary; `NotaryRequirement`
 * is embedded on `RequiredForm` and `NotarySummary` on `Opportunity` — both owned
 * and persisted by u2 (notary-backend-wiring).
 */

// ─── NotaryStatus — three-state classification with an implicit severity order ─

export const NotaryStatusSchema = z.enum([
  'REQUIRED',
  'POSSIBLY_REQUIRED',
  'NOT_REQUIRED',
]);
export type NotaryStatus = z.infer<typeof NotaryStatusSchema>;

/**
 * Severity rank of a notary status: REQUIRED (3) > POSSIBLY_REQUIRED (2) >
 * NOT_REQUIRED (1). Drives the strongest-signal merge (BR4.1) — a weaker source
 * can never downgrade a stronger one. POSSIBLY_REQUIRED is a positive
 * "review needed" signal for the zero-miss posture, so it outranks NOT_REQUIRED.
 */
export const statusSeverity = (status: NotaryStatus): number => {
  switch (status) {
    case 'REQUIRED':
      return 3;
    case 'POSSIBLY_REQUIRED':
      return 2;
    case 'NOT_REQUIRED':
      return 1;
  }
};

// ─── NotaryCue — which deterministic cue triggered a candidate ────────────────

export const NotaryCueSchema = z.enum([
  'KEYWORD',
  'ACK_BLOCK',
  'STATE_COUNTY',
  'COMMISSION',
  'SWORN',
  'WITNESS',
  'INSTRUCTIONAL',
]);
export type NotaryCue = z.infer<typeof NotaryCueSchema>;

// ─── NotarySource — provenance of a scanned segment / candidate ───────────────

export const NotarySourceSchema = z.enum([
  'SOLICITATION_BODY',
  'FORM_PAGE',
  'FORM_FIELD',
]);
export type NotarySource = z.infer<typeof NotarySourceSchema>;

// ─── NotaryTextSegment — the source-agnostic INPUT to Stage-1 generation ──────
//
// The only shape the engine's Stage-1 API accepts. u2 extracts these from
// Textract blocks, solicitation docText, and DOCX/XLSX field text; u1 scans
// them without knowing their origin (BR1.4 — no Textract/DOCX types in u1).

export const NotaryTextSegmentSchema = z.object({
  text: z.string().min(1),
  source: NotarySourceSchema,
  documentName: z.string().min(1),
  formId: z.string().optional(),
  // Present only for FORM_PAGE segments; absent otherwise (constraint below).
  pageNumber: z.number().int().min(1).optional(),
  // Candidate form-name to help map SOLICITATION_BODY hits to a detected form.
  formHint: z.string().optional(),
});
export type NotaryTextSegment = z.infer<typeof NotaryTextSegmentSchema>;

// ─── NotaryCandidate — a Stage-1 pattern hit (transient) ──────────────────────
//
// The output of deterministic candidate generation and the input to Stage-2
// verification. Over-flagging here is intentional (high recall); Stage-2 is the
// precision gate. Dedup identity: (source + documentName + offset).

export const NotaryCandidateSchema = z.object({
  source: NotarySourceSchema,
  cue: NotaryCueSchema,
  // Verbatim matched text plus a bounded context window.
  triggeringText: z.string().min(1),
  documentName: z.string().min(1),
  formId: z.string().optional(),
  pageNumber: z.number().int().min(1).optional(),
  formHint: z.string().optional(),
  // Match position within the segment, for dedup.
  offset: z.number().int().min(0).optional(),
});
export type NotaryCandidate = z.infer<typeof NotaryCandidateSchema>;

// ─── NotaryRequirement — a classified, evidence-bearing Stage-2 output ────────
//
// The FR3.1 evidence shape. Embedded as an array on RequiredForm (persisted by
// u2) and folded into the opportunity rollup. Natural key for merge/dedup:
// ((formId or documentName) + cue + triggeringText).

export const NotaryRequirementSchema = z.object({
  // The detected form this points at; absent for an unmapped solicitation instruction.
  formId: z.string().optional(),
  documentName: z.string().min(1),
  status: NotaryStatusSchema,
  cue: NotaryCueSchema,
  // Positive integer only for FORM_PAGE-sourced triggers; null for
  // SOLICITATION_BODY / FORM_FIELD (BR6.2 — never fabricate a page for pageless text).
  pageNumber: z.number().int().min(1).nullable().default(null),
  // Verbatim evidence + guardrail audit trail.
  triggeringText: z.string().min(1),
  // One-line model rationale, especially for POSSIBLY_REQUIRED.
  rationale: z.string().optional(),
});
export type NotaryRequirement = z.infer<typeof NotaryRequirementSchema>;

// ─── NotarySummary — opportunity-level rollup (schema owned here, computed by u2) ─

export const NotarySummarySchema = z.object({
  // True if ANY form/instruction is REQUIRED or POSSIBLY_REQUIRED.
  anyNotaryRequired: z.boolean().default(false),
  requiredCount: z.number().int().min(0).default(0),
  possiblyRequiredCount: z.number().int().min(0).default(0),
  // Denominator for "2 of 6 forms".
  totalFormsConsidered: z.number().int().min(0).default(0),
  computedAt: z.string().optional(),
});
export type NotarySummary = z.infer<typeof NotarySummarySchema>;

// ─── NotaryClassificationSource — override provenance marker (owned by u2) ────
//
// Provenance of a persisted notary classification, mirroring the
// deliveryLocationConstraint source marker. AI_DETECTED is recomputed wholesale
// by every detection re-run; a USER_SET value is never overwritten by a re-run
// (FR7.2) — the atomic conditional writes in u2 (notary-backend-wiring) enforce
// this on both RequiredForm.notarySource and Opportunity.notarySummarySource.

export const NotaryClassificationSourceSchema = z.enum(['AI_DETECTED', 'USER_SET']);
export type NotaryClassificationSource = z.infer<typeof NotaryClassificationSourceSchema>;
