/**
 * Opportunity approval transition helpers (RFP-tracking two-gate workflow).
 *
 * Parallels opportunity-status.ts but for the approval axis — it does NOT touch
 * `status` (which drives brief scoring, APN sync, WON/LOST notifications, and
 * the Slack digest). Unlike the permissive status helper, this enforces an
 * allowed-transition map: only the six forward/reject edges are legal.
 *
 *   INITIAL_APPROVAL → I_APPROVED | NOT_APPROVED   (gate 1)
 *   I_APPROVED       → PRE_SUB_APPROVAL            (stage)
 *   PRE_SUB_APPROVAL → II_APPROVED                 (gate 2)
 *   II_APPROVED      → SUBMITTED                   (stage)
 */

import { nowIso } from '@/helpers/date';
import { getOpportunity, updateOpportunity } from '@/helpers/opportunity';
import type { UserContext } from '@/helpers/db';
import type {
  OpportunityItem,
  OpportunityApprovalStatus,
  OpportunityApprovalTransition,
} from '@auto-rfp/core';

export type ApprovalGate = OpportunityApprovalTransition['gate'];

/** Legal approval transitions. Anything not listed here throws. */
const ALLOWED_APPROVAL_TRANSITIONS: Record<OpportunityApprovalStatus, OpportunityApprovalStatus[]> = {
  INITIAL_APPROVAL: ['I_APPROVED', 'NOT_APPROVED'],
  I_APPROVED:       ['PRE_SUB_APPROVAL'],
  PRE_SUB_APPROVAL: ['II_APPROVED'],
  II_APPROVED:      ['SUBMITTED'],
  SUBMITTED:        [],
  NOT_APPROVED:     [],
};

/** Thrown when a requested approval transition is not permitted. */
export class InvalidApprovalTransitionError extends Error {
  constructor(
    public readonly from: OpportunityApprovalStatus,
    public readonly to: OpportunityApprovalStatus,
  ) {
    super(`Illegal approval transition: ${from} → ${to}`);
    this.name = 'InvalidApprovalTransitionError';
  }
}

export interface ApprovalTransitionArgs {
  orgId: string;
  projectId: string;
  oppId: string;
  to: OpportunityApprovalStatus;
  changedBy: string;
  gate: ApprovalGate;
  reason?: string;
  userContext?: UserContext;
}

/**
 * Transition an opportunity to a new approval status. Loads the current opp,
 * derives its current approvalStatus (default INITIAL_APPROVAL), validates the
 * edge against the allowed-transition map, appends to approvalHistory, and
 * persists both fields via updateOpportunity. Returns the updated item.
 *
 * @throws Error when the opportunity is not found.
 * @throws InvalidApprovalTransitionError when the edge is not allowed.
 */
export const transitionOpportunityApproval = async (
  args: ApprovalTransitionArgs,
): Promise<OpportunityItem> => {
  const { orgId, projectId, oppId, to, changedBy, gate, reason, userContext } = args;

  const existing = await getOpportunity({ orgId, projectId, oppId });
  if (!existing) {
    throw new Error(`Opportunity not found: orgId=${orgId}, projectId=${projectId}, oppId=${oppId}`);
  }

  const from: OpportunityApprovalStatus =
    (existing.item.approvalStatus as OpportunityApprovalStatus | undefined) ?? 'INITIAL_APPROVAL';

  if (!ALLOWED_APPROVAL_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidApprovalTransitionError(from, to);
  }

  const now = nowIso();
  const transition: OpportunityApprovalTransition = {
    from,
    to,
    changedAt: now,
    changedBy,
    gate,
    ...(reason ? { reason } : {}),
  };

  const existingHistory =
    (existing.item.approvalHistory as OpportunityApprovalTransition[] | undefined) ?? [];

  const { item } = await updateOpportunity({
    orgId,
    projectId,
    oppId,
    patch: {
      approvalStatus: to,
      approvalHistory: [...existingHistory, transition],
    },
    userContext,
  });

  console.log(
    `[opportunity-approval] ${from} → ${to} for oppId=${oppId} ` +
    `(gate=${gate}, changedBy=${changedBy}${reason ? `, reason=${reason}` : ''})`,
  );

  return item as OpportunityItem;
};
