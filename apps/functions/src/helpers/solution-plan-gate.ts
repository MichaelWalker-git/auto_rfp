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
import { SolutionPlanStatusSchema, type RFPDocumentType, type SolutionPlanKey } from '@auto-rfp/core';

import { getOrganizationById } from '@/helpers/org';
import { getSolutionPlanByOpportunity } from '@/helpers/solution-plan';
import { listRFPDocumentsByProject } from '@/helpers/rfp-document';

/** Document types that never require a Solution Plan. */
export const GATE_EXEMPT_DOCUMENT_TYPES = [
  'CLARIFYING_QUESTIONS',
  'QUESTIONS_AND_ANSWERS',
  'QUESTIONNAIRE',
] as const;

const EXEMPT_TYPES: ReadonlySet<string> = new Set(GATE_EXEMPT_DOCUMENT_TYPES);

/** True when the document type requires a READY Solution Plan (custom types are gated). */
export const isGatedDocumentType = (documentType: RFPDocumentType): boolean =>
  !EXEMPT_TYPES.has(documentType);

/** Gate verdict; `solutionPlanStatus` is null when no plan exists for the opportunity. */
export const SolutionPlanGateResultSchema = z.object({
  allowed: z.boolean(),
  solutionPlanStatus: SolutionPlanStatusSchema.nullable(),
});

export type SolutionPlanGateResult = z.infer<typeof SolutionPlanGateResultSchema>;

const GATE_OPEN: SolutionPlanGateResult = { allowed: true, solutionPlanStatus: null };

/**
 * Grandfathering (ADR-10): any pre-existing *generated* gated-type document
 * opens the gate. Uploaded files (fileKey/originalFileName present) don't
 * count — uploading e.g. a signed NDA must not unlock proposal generation.
 */
const hasExistingGatedDocument = async (
  projectId: string,
  opportunityId: string,
): Promise<boolean> => {
  let nextToken: Record<string, unknown> | undefined;
  do {
    const page = await listRFPDocumentsByProject({ projectId, opportunityId, nextToken });
    const found = page.items.some(
      (doc) =>
        typeof doc.documentType === 'string' &&
        isGatedDocumentType(doc.documentType) &&
        !doc.fileKey &&
        !doc.originalFileName,
    );
    if (found) return true;
    nextToken = page.nextToken ?? undefined;
  } while (nextToken);
  return false;
};

/**
 * Decide whether document generation may proceed for this opportunity + type.
 * Called by `generate-document` before creating the placeholder document.
 */
export const checkSolutionPlanGate = async (
  args: SolutionPlanKey & { documentType: RFPDocumentType },
): Promise<SolutionPlanGateResult> => {
  const { orgId, projectId, opportunityId, documentType } = args;

  if (!isGatedDocumentType(documentType)) return GATE_OPEN;
  if (process.env.SOLUTION_PLAN_GATING === 'off') return GATE_OPEN;

  const org = await getOrganizationById(orgId);
  if (!org?.enableSolutionPlan) return GATE_OPEN;

  const plan = await getSolutionPlanByOpportunity({ orgId, projectId, opportunityId });
  const solutionPlanStatus = plan?.status ?? null;
  if (solutionPlanStatus === 'READY') return { allowed: true, solutionPlanStatus };

  if (await hasExistingGatedDocument(projectId, opportunityId)) {
    return { allowed: true, solutionPlanStatus };
  }

  return { allowed: false, solutionPlanStatus };
};
