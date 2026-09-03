/**
 * Opportunity status transition helpers.
 *
 * The opportunity `status` is the unified pipeline + outcome state. Terminal
 * statuses (WON/LOST/NO_BID/WITHDRAWN) ARE the outcome; the structured outcome
 * detail (winData/lossData/jurisdiction/state/outcomeComment) lives on the same
 * record. All transitions are recorded in statusHistory for audit purposes.
 *
 * Automatic transitions:
 *   IDENTIFIED  → QUALIFYING  when executive brief generation starts
 *   QUALIFYING  → PURSUING    when brief scoring decision = GO
 *   QUALIFYING  → NO_BID      when brief scoring decision = NO_GO
 *   PURSUING    → SUBMITTED   when a proposal is submitted
 */

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { buildOpportunitySk, getOpportunity } from '@/helpers/opportunity';
import type {
  OpportunityItem,
  OpportunityStatus,
  OpportunityStatusTransition,
  WinData,
  LossData,
  Jurisdiction,
} from '@auto-rfp/core';
import { ACTIVE_OPPORTUNITY_STATUSES, TERMINAL_OPPORTUNITY_STATUSES } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransitionSource = 'MANUAL' | 'BRIEF_SCORING' | 'SYSTEM';

/** Structured outcome detail written alongside a terminal status change. */
export interface OutcomeDetail {
  outcomeComment?: string | null;
  winData?: WinData;
  lossData?: LossData;
  jurisdiction?: Jurisdiction;
  state?: string | null;
}

export interface TransitionArgs {
  orgId: string;
  projectId: string;
  oppId: string;
  toStatus: OpportunityStatus;
  changedBy: string;
  reason?: string;
  source: TransitionSource;
  /** Optional outcome detail to persist when moving to a terminal status. */
  outcome?: OutcomeDetail;
}

const isTerminal = (status: OpportunityStatus): boolean =>
  TERMINAL_OPPORTUNITY_STATUSES.includes(status);

// ─── Core transition function ─────────────────────────────────────────────────

/**
 * Transition an opportunity to a new status.
 * Records the transition in statusHistory, updates the `active` flag, persists
 * any outcome detail, and syncs terminal statuses to AWS Partner Central.
 * Returns the updated opportunity item.
 */
export const transitionOpportunityStatus = async (
  args: TransitionArgs,
): Promise<OpportunityItem> => {
  const { orgId, projectId, oppId, toStatus, changedBy, reason, source, outcome } = args;

  // Load current state
  const existing = await getOpportunity({ orgId, projectId, oppId });
  if (!existing) {
    throw new Error(`Opportunity not found: orgId=${orgId}, projectId=${projectId}, oppId=${oppId}`);
  }

  const currentStatus: OpportunityStatus = (existing.item.status as OpportunityStatus) ?? 'IDENTIFIED';

  const now = nowIso();
  const isActive = ACTIVE_OPPORTUNITY_STATUSES.includes(toStatus);
  const terminal = isTerminal(toStatus);

  // Build the SET clause. `status` is a DynamoDB reserved word → always alias #status.
  const names: Record<string, string> = {
    '#status': 'status',
    '#active': 'active',
    '#statusHistory': 'statusHistory',
    '#updatedAt': 'updatedAt',
    '#pk': PK_NAME,
    '#sk': SK_NAME,
  };
  const values: Record<string, unknown> = {
    ':status': toStatus,
    ':active': isActive,
    ':now': now,
  };
  const setParts = ['#status = :status', '#active = :active', '#updatedAt = :now'];

  // Only append a history entry when the status actually changes.
  if (currentStatus !== toStatus) {
    const transition: OpportunityStatusTransition = {
      from: currentStatus,
      to: toStatus,
      changedAt: now,
      changedBy,
      reason,
      source,
    };
    const existingHistory =
      (existing.item.statusHistory as OpportunityStatusTransition[] | undefined) ?? [];
    values[':history'] = [...existingHistory, transition];
    setParts.push('#statusHistory = :history');
  }

  // Persist outcome detail (terminal moves), plus outcomeDate/outcomeSetBy stamps.
  if (outcome) {
    if (outcome.outcomeComment !== undefined) {
      names['#outcomeComment'] = 'outcomeComment';
      values[':outcomeComment'] = outcome.outcomeComment;
      setParts.push('#outcomeComment = :outcomeComment');
    }
    if (outcome.winData !== undefined) {
      names['#winData'] = 'winData';
      values[':winData'] = outcome.winData;
      setParts.push('#winData = :winData');
    }
    if (outcome.lossData !== undefined) {
      names['#lossData'] = 'lossData';
      values[':lossData'] = outcome.lossData;
      setParts.push('#lossData = :lossData');
    }
    if (outcome.jurisdiction !== undefined) {
      names['#jurisdiction'] = 'jurisdiction';
      values[':jurisdiction'] = outcome.jurisdiction;
      setParts.push('#jurisdiction = :jurisdiction');
    }
    if (outcome.state !== undefined) {
      names['#state'] = 'state';
      values[':state'] = outcome.state;
      setParts.push('#state = :state');
    }
  }

  if (terminal) {
    names['#outcomeDate'] = 'outcomeDate';
    names['#outcomeSetBy'] = 'outcomeSetBy';
    values[':outcomeDate'] = now;
    values[':outcomeSetBy'] = changedBy;
    setParts.push('#outcomeDate = :outcomeDate', '#outcomeSetBy = :outcomeSetBy');
  }

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: OPPORTUNITY_PK,
        [SK_NAME]: buildOpportunitySk(orgId, projectId, oppId),
      },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );

  console.log(
    `[opportunity-status] ${currentStatus} → ${toStatus} for oppId=${oppId} ` +
    `(source=${source}, changedBy=${changedBy}${reason ? `, reason=${reason}` : ''})`,
  );

  // Sync to AWS Partner Central for SUBMITTED + terminal statuses.
  const apnSyncStatuses: OpportunityStatus[] = ['SUBMITTED', 'WON', 'LOST', 'NO_BID', 'WITHDRAWN'];
  if (apnSyncStatuses.includes(toStatus)) {
    const { syncOpportunityToApn } = await import('@/helpers/apn-db');
    await syncOpportunityToApn({
      orgId,
      projectId,
      oppId,
      customerName:      (res.Attributes?.organizationName as string | undefined) ?? 'Unknown Customer',
      opportunityTitle:  (res.Attributes?.title as string | undefined) ?? 'Untitled Opportunity',
      opportunityValue:  (res.Attributes?.baseAndAllOptionsValue as number | undefined) ?? 0,
      expectedCloseDate: (res.Attributes?.responseDeadlineIso as string | undefined) ?? new Date().toISOString(),
      status:            toStatus,
      description:       typeof res.Attributes?.description === 'string'
        ? res.Attributes.description.substring(0, 500)
        : undefined,
      existingApnId:     (res.Attributes?.apnOpportunityId as string | undefined) ?? null,
    });
  }

  return res.Attributes as OpportunityItem;
};

// ─── Automatic transition helpers ─────────────────────────────────────────────

/**
 * Called when executive brief generation starts for an opportunity.
 * Transitions IDENTIFIED → QUALIFYING (no-op if already past IDENTIFIED).
 * Fire-and-forget.
 */
export const onBriefGenerationStarted = (args: {
  orgId: string;
  projectId: string;
  oppId: string;
}): void => {
  (async () => {
    try {
      const existing = await getOpportunity(args);
      if (!existing) return;

      const currentStatus = (existing.item.status as OpportunityStatus) ?? 'IDENTIFIED';
      if (currentStatus !== 'IDENTIFIED') return; // Already past this status

      await transitionOpportunityStatus({
        ...args,
        toStatus: 'QUALIFYING',
        changedBy: 'system',
        reason: 'Executive brief generation started',
        source: 'BRIEF_SCORING',
      });
    } catch (err) {
      console.warn('[opportunity-status] onBriefGenerationStarted failed (non-blocking):', (err as Error)?.message);
    }
  })();
};

/**
 * Called when executive brief scoring completes.
 *   GO             → PURSUING
 *   NO_GO          → NO_BID
 *   CONDITIONAL_GO → stays QUALIFYING (needs manual decision)
 * Fire-and-forget.
 */
export const onBriefScoringComplete = (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  decision: 'GO' | 'NO_GO' | 'CONDITIONAL_GO';
  compositeScore?: number;
}): void => {
  const { decision, compositeScore, ...location } = args;

  (async () => {
    try {
      const existing = await getOpportunity(location);
      if (!existing) return;

      const currentStatus = (existing.item.status as OpportunityStatus) ?? 'IDENTIFIED';

      // Only auto-transition from QUALIFYING or IDENTIFIED
      if (!['IDENTIFIED', 'QUALIFYING'].includes(currentStatus)) return;

      if (decision === 'GO') {
        await transitionOpportunityStatus({
          ...location,
          toStatus: 'PURSUING',
          changedBy: 'system',
          reason: `Brief scoring: GO decision${compositeScore !== undefined ? ` (score: ${compositeScore}/5)` : ''}`,
          source: 'BRIEF_SCORING',
        });
      } else if (decision === 'NO_GO') {
        await transitionOpportunityStatus({
          ...location,
          toStatus: 'NO_BID',
          changedBy: 'system',
          reason: `Brief scoring: NO_GO decision${compositeScore !== undefined ? ` (score: ${compositeScore}/5)` : ''}`,
          source: 'BRIEF_SCORING',
        });
      }
      // CONDITIONAL_GO: stay in QUALIFYING, requires manual decision
    } catch (err) {
      console.warn('[opportunity-status] onBriefScoringComplete failed (non-blocking):', (err as Error)?.message);
    }
  })();
};
