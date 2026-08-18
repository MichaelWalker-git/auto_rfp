/**
 * Server-side Solution Plan generation gate (T9).
 *
 * For gated document types, generation is refused (409 SOLUTION_PLAN_REQUIRED)
 * until the opportunity has a Solution Plan with status READY. A stale plan is
 * still READY — `isStale` never closes the gate (ADR-3).
 *
 * Escape hatches, checked cheapest-first:
 *  - exempt document types (Q&A-style exports don't need a plan)
 *  - env `SOLUTION_PLAN_GATING=off` (stage-wide kill switch)
 *  - org flag `enableSolutionPlan` off (manual-DDB flag; off = no gate)
 *  - grandfathering (ADR-10): an opportunity that already has ≥1 generated
 *    gated-type document predates the gate and keeps working
 */
import { z } from 'zod';
import {
  SOLUTION_PLAN_GATE_EXEMPT_DOCUMENT_TYPES,
  SolutionPlanStatusSchema,
  isSolutionPlanGatedDocumentType,
  type RFPDocumentType,
  type SolutionPlanKey,
} from '@auto-rfp/core';

import { getOrganizationById } from '@/helpers/org';
import { getSolutionPlanByOpportunity } from '@/helpers/solution-plan';
import { listRFPDocumentsByProject } from '@/helpers/rfp-document';

/** Env var name for the stage-wide gating kill switch; set to {@link SOLUTION_PLAN_GATING_OFF} to disable the gate. */
export const SOLUTION_PLAN_GATING_ENV = 'SOLUTION_PLAN_GATING';
export const SOLUTION_PLAN_GATING_OFF = 'off';

/** Document types that never require a Solution Plan (defined in core, shared with the web gate UI). */
export const GATE_EXEMPT_DOCUMENT_TYPES = SOLUTION_PLAN_GATE_EXEMPT_DOCUMENT_TYPES;

/** True when the document type requires a READY Solution Plan (custom types are gated). */
export const isGatedDocumentType = (documentType: RFPDocumentType): boolean =>
  isSolutionPlanGatedDocumentType(documentType);

/** Gate verdict; `solutionPlanStatus` is null when no plan exists for the opportunity. */
export const SolutionPlanGateResultSchema = z.object({
  allowed: z.boolean(),
  solutionPlanStatus: SolutionPlanStatusSchema.nullable(),
});

export type SolutionPlanGateResult = z.infer<typeof SolutionPlanGateResultSchema>;

const GATE_OPEN: SolutionPlanGateResult = { allowed: true, solutionPlanStatus: null };

/**
 * A document counts as *generated* when it carries produced content:
 *  - `htmlContentKey` — set by the generation worker on success (and by editor
 *    saves). Survives a Google Drive sync, which adds a `fileKey` for the DOCX
 *    export on top of it — so synced generated documents still count.
 *  - legacy fallback: structured `content` in DynamoDB with no file fields
 *    (documents generated before HTML moved to S3).
 * Placeholders stuck GENERATING/FAILED have neither, and uploaded files
 * (fileKey/originalFileName, no htmlContentKey) never count — uploading e.g.
 * a signed NDA must not unlock proposal generation.
 */
const isGeneratedDocument = (doc: Record<string, unknown>): boolean =>
  Boolean(doc.htmlContentKey) ||
  (doc.content != null && !doc.fileKey && !doc.originalFileName);

/**
 * Grandfathering (ADR-10): any pre-existing successfully *generated*
 * gated-type document opens the gate.
 */
const hasExistingGatedDocument = async ({
  projectId,
  opportunityId,
}: Pick<SolutionPlanKey, 'projectId' | 'opportunityId'>): Promise<boolean> => {
  let nextToken: Record<string, unknown> | undefined;
  do {
    const page = await listRFPDocumentsByProject({ projectId, opportunityId, nextToken });
    const found = page.items.some(
      (doc) =>
        typeof doc.documentType === 'string' &&
        isGatedDocumentType(doc.documentType) &&
        isGeneratedDocument(doc),
    );
    if (found) return true;
    nextToken = page.nextToken ?? undefined;
  } while (nextToken);
  return false;
};

/**
 * Decide whether document generation may proceed for this opportunity + type.
 * Called by `generate-document` before creating the placeholder document.
 *
 * `loadOrg` exists so a caller composing this gate with another one can share
 * a single org read (see `generation-preconditions.ts`). It stays a thunk
 * rather than a plain value so the cheap short-circuits above it still read
 * nothing at all — an exempt document type must not pay for a GetItem.
 */
export const checkSolutionPlanGate = async (
  args: SolutionPlanKey & {
    documentType: RFPDocumentType;
    loadOrg?: () => Promise<{ enableSolutionPlan?: boolean } | null>;
  },
): Promise<SolutionPlanGateResult> => {
  const { orgId, projectId, opportunityId, documentType, loadOrg } = args;

  if (!isGatedDocumentType(documentType)) return GATE_OPEN;
  if (process.env[SOLUTION_PLAN_GATING_ENV] === SOLUTION_PLAN_GATING_OFF) return GATE_OPEN;

  const org = loadOrg ? await loadOrg() : await getOrganizationById(orgId);
  if (!org?.enableSolutionPlan) return GATE_OPEN;

  const plan = await getSolutionPlanByOpportunity({ orgId, projectId, opportunityId });
  const solutionPlanStatus = plan?.status ?? null;
  if (solutionPlanStatus === 'READY') return { allowed: true, solutionPlanStatus };

  if (await hasExistingGatedDocument({ projectId, opportunityId })) {
    return { allowed: true, solutionPlanStatus };
  }

  return { allowed: false, solutionPlanStatus };
};
