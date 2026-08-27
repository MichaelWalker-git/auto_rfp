/**
 * The pre-generation gate: one gate, two precondition types, one refusal model.
 *
 * `generate-document` asks this module once, before it creates a placeholder or
 * enqueues any work. Two preconditions are checked, cheapest first:
 *
 *  1. **Solution Plan** (T9) — gated document types need a READY plan.
 *  2. **KB coverage** — the KB must hold the content the document type
 *     requires (personnel bios, certification records, …).
 *
 * Both refuse the same way: 409 with a machine-readable `code` and, for
 * coverage, the missing categories named. A second, separate gate would give
 * the frontend two refusal shapes to handle and two places to drift.
 *
 * ## Ordering
 *
 * Solution Plan wins. It is the cheaper, coarser, already-shipped
 * precondition, and an opportunity with no plan usually can't act on a KB gap
 * yet anyway. Checking it first also means a plan refusal costs zero coverage
 * reads.
 *
 * ## Escape hatches (coverage), cheapest first
 *
 *  1. document type has no KB requirements → open, zero reads
 *  2. env `KB_COVERAGE_GATING=off` → open (stage-wide kill switch)
 *  3. org flag `enableKBCoverageGate` off → open (the default: warn-only)
 *  4. every required category present → open
 *
 * Unlike the plan gate, coverage does **not** grandfather: an existing
 * generated document says nothing about whether the KB holds personnel data
 * *now*. That makes coverage stricter than the plan gate on grandfathered
 * opportunities, which is intended.
 */
import {
  buildKBCoverageIncompleteMessage,
  getMissingCoverageCategories,
  getRequiredCoverageCategories,
  type GenerationPreconditionErrorCode,
  type KBCoverageMissingCategory,
  type OrganizationItem,
  type RFPDocumentType,
  type SolutionPlanKey,
  type SolutionPlanStatus,
} from '@auto-rfp/core';

import { getOrganizationById } from '@/helpers/org';
import { checkSolutionPlanGate } from '@/helpers/solution-plan-gate';
import {
  computeKBCoverageSnapshot,
  isKBCoverageGateArmed,
  isKBCoverageGatingDisabled,
} from '@/helpers/kb-coverage';

const SOLUTION_PLAN_REQUIRED_MESSAGE =
  'A ready Solution Plan is required before generating this document type. Create a Solution Plan for this opportunity first.';

/**
 * The 409 body. Discriminated on `code` so the frontend branches on a value,
 * not a message string.
 *
 * The `SOLUTION_PLAN_REQUIRED` shape is byte-identical to what T9 shipped
 * (`message`, `code`, `solutionPlanStatus`) — the web app's
 * `toGenerateDocumentError` parses it, so changing it would break a released
 * client.
 */
export type GenerationPreconditionRefusal =
  | {
      code: Extract<GenerationPreconditionErrorCode, 'SOLUTION_PLAN_REQUIRED'>;
      message: string;
      solutionPlanStatus: SolutionPlanStatus | null;
    }
  | {
      code: Extract<GenerationPreconditionErrorCode, 'KB_COVERAGE_INCOMPLETE'>;
      message: string;
      missingCategories: KBCoverageMissingCategory[];
    };

export type GenerationPreconditionResult =
  | { allowed: true }
  | { allowed: false; refusal: GenerationPreconditionRefusal };

const ALLOWED: GenerationPreconditionResult = { allowed: true };

/**
 * Memoizes the org read so composing the two gates costs one GetItem, not two,
 * while still reading nothing when every gate short-circuits before it needs
 * the org.
 */
const createOrgLoader = (orgId: string): (() => Promise<OrganizationItem | null>) => {
  let pending: Promise<OrganizationItem | null> | undefined;
  return () => (pending ??= getOrganizationById(orgId));
};

/**
 * KB coverage precondition. Returns the named missing categories so the caller
 * can put them straight in the 409 body and the UI can print the same words.
 */
export const checkKBCoverageGate = async (args: {
  orgId: string;
  documentType: RFPDocumentType;
  loadOrg?: () => Promise<OrganizationItem | null>;
}): Promise<{ allowed: boolean; missingCategories: KBCoverageMissingCategory[] }> => {
  const { orgId, documentType, loadOrg } = args;

  const required = getRequiredCoverageCategories(documentType);
  if (required.length === 0) return { allowed: true, missingCategories: [] };

  if (isKBCoverageGatingDisabled()) return { allowed: true, missingCategories: [] };

  const org = loadOrg ? await loadOrg() : await getOrganizationById(orgId);
  if (!isKBCoverageGateArmed(org)) return { allowed: true, missingCategories: [] };

  const snapshot = await computeKBCoverageSnapshot(orgId, required);
  const missingCategories = getMissingCoverageCategories(documentType, snapshot);

  return { allowed: missingCategories.length === 0, missingCategories };
};

/**
 * Check every precondition for generating this document type.
 * Called by `generate-document` before it writes anything or enqueues a job.
 */
export const checkGenerationPreconditions = async (
  args: SolutionPlanKey & { documentType: RFPDocumentType },
): Promise<GenerationPreconditionResult> => {
  const { orgId, projectId, opportunityId, documentType } = args;
  const loadOrg = createOrgLoader(orgId);

  const { allowed: planAllowed, solutionPlanStatus } = await checkSolutionPlanGate({
    orgId,
    projectId,
    opportunityId,
    documentType,
    loadOrg,
  });
  if (!planAllowed) {
    return {
      allowed: false,
      refusal: {
        code: 'SOLUTION_PLAN_REQUIRED',
        message: SOLUTION_PLAN_REQUIRED_MESSAGE,
        solutionPlanStatus,
      },
    };
  }

  const { allowed: coverageAllowed, missingCategories } = await checkKBCoverageGate({
    orgId,
    documentType,
    loadOrg,
  });
  if (!coverageAllowed) {
    return {
      allowed: false,
      refusal: {
        code: 'KB_COVERAGE_INCOMPLETE',
        message: buildKBCoverageIncompleteMessage(missingCategories),
        missingCategories,
      },
    };
  }

  return ALLOWED;
};
