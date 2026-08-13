import { isSolutionPlanGatedDocumentType, type RFPDocumentItem } from '@auto-rfp/core';

/**
 * Client-side mirrors of the server generation gate's grandfathering check
 * (`apps/functions/src/helpers/solution-plan-gate.ts`, ADR-10). The server
 * stays authoritative — these only decide when the UI disables generation
 * entry points, so they must never be stricter than the backend.
 *
 * Known exception: the server's stage-wide `SOLUTION_PLAN_GATING=off` kill
 * switch is not visible to the client, so while it is active the UI still
 * gates flagged orgs even though the server would allow generation. Accepted —
 * the switch is an emergency lever, not a product state.
 */

/** The minimal document shape the grandfather check reads. */
export type GateDocumentLike = Pick<
  RFPDocumentItem,
  'documentType' | 'htmlContentKey' | 'content' | 'fileKey' | 'originalFileName'
>;

/**
 * A document counts as *generated* when it carries produced content:
 * `htmlContentKey` (set by the generation worker / editor saves), or legacy
 * structured `content` with no file fields. Uploaded files and placeholders
 * stuck GENERATING/FAILED never count — mirrors the server's rule exactly.
 */
export const isGeneratedDocument = (doc: GateDocumentLike): boolean =>
  Boolean(doc.htmlContentKey) ||
  (doc.content != null && !doc.fileKey && !doc.originalFileName);

/**
 * Grandfathering (ADR-10): an opportunity that already has ≥1 successfully
 * generated gated-type document predates the gate and keeps working.
 */
export const hasGrandfatheredDocument = (documents: readonly GateDocumentLike[]): boolean =>
  documents.some(
    (doc) => isSolutionPlanGatedDocumentType(doc.documentType) && isGeneratedDocument(doc),
  );
