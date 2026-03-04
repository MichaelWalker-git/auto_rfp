/**
 * Opportunity pipeline stage transition helpers.
 *
 * Handles both manual and automatic stage transitions.
 * All transitions are recorded in stageHistory for audit purposes.
 *
 * Automatic transitions:
 *   IDENTIFIED  → QUALIFYING  when executive brief generation starts
 *   QUALIFYING  → PURSUING    when brief scoring decision = GO
 *   QUALIFYING  → NO_BID      when brief scoring decision = NO_GO
 *   PURSUING    → SUBMITTED   when project outcome = PENDING
 *   SUBMITTED   → WON         when project outcome = WON
 *   SUBMITTED   → LOST        when project outcome = LOST
 *   Any stage   → WITHDRAWN   when project outcome = WITHDRAWN
 */

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { buildOpportunitySk, getOpportunity } from '@/helpers/opportunity';
import { triggerApnRegistration } from '@/helpers/apn';
import type {
  OpportunityItem,
  OpportunityStage,
  OpportunityStageTransition,
} from '@auto-rfp/core';
import { ACTIVE_OPPORTUNITY_STAGES } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransitionSource = 'MANUAL' | 'BRIEF_SCORING' | 'PROJECT_OUTCOME' | 'SYSTEM';

export interface TransitionArgs {
  orgId: string;
  projectId: string;
  oppId: string;
  toStage: OpportunityStage;
  changedBy: string;
  reason?: string;
  source: TransitionSource;
}

// ─── Core transition function ─────────────────────────────────────────────────

/**
 * Transition an opportunity to a new pipeline stage.
 * Records the transition in stageHistory and updates the `active` flag.
 * Returns the updated opportunity item.
 */
export const transitionOpportunityStage = async (
  args: TransitionArgs,
): Promise<OpportunityItem> => {
  const { orgId, projectId, oppId, toStage, changedBy, reason, source } = args;

  // Load current state
  const existing = await getOpportunity({ orgId, projectId, oppId });
  if (!existing) {
    throw new Error(`Opportunity not found: orgId=${orgId}, projectId=${projectId}, oppId=${oppId}`);
  }

  const currentStage: OpportunityStage = (existing.item.stage as OpportunityStage) ?? 'IDENTIFIED';

  // No-op if already in target stage
  if (currentStage === toStage) {
    return existing.item as OpportunityItem;
  }

  const now = nowIso();
  const transition: OpportunityStageTransition = {
    from: currentStage,
    to: toStage,
    changedAt: now,
    changedBy,
    reason,
    source,
  };

  const existingHistory = (existing.item.stageHistory as OpportunityStageTransition[] | undefined) ?? [];
  const newHistory = [...existingHistory, transition];

  // Derive `active` from stage
  const isActive = ACTIVE_OPPORTUNITY_STAGES.includes(toStage);

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: OPPORTUNITY_PK,
        [SK_NAME]: buildOpportunitySk(orgId, projectId, oppId),
      },
      UpdateExpression: 'SET #stage = :stage, #active = :active, #stageHistory = :history, #updatedAt = :now',
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
      ExpressionAttributeNames: {
        '#stage': 'stage',
        '#active': 'active',
        '#stageHistory': 'stageHistory',
        '#updatedAt': 'updatedAt',
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':stage': toStage,
        ':active': isActive,
        ':history': newHistory,
        ':now': now,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  console.log(
    `[opportunity-stage] ${currentStage} → ${toStage} for oppId=${oppId} ` +
    `(source=${source}, changedBy=${changedBy}${reason ? `, reason=${reason}` : ''})`,
  );

  return res.Attributes as OpportunityItem;
};

// ─── Automatic transition helpers ─────────────────────────────────────────────

/**
 * Called when executive brief generation starts for an opportunity.
 * Transitions IDENTIFIED → QUALIFYING (no-op if already past IDENTIFIED).
 */
export const onBriefGenerationStarted = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
}): Promise<void> => {
  try {
    const existing = await getOpportunity(args);
    if (!existing) return;

    const currentStage = (existing.item.stage as OpportunityStage) ?? 'IDENTIFIED';
    if (currentStage !== 'IDENTIFIED') return; // Already past this stage

    await transitionOpportunityStage({
      ...args,
      toStage: 'QUALIFYING',
      changedBy: 'system',
      reason: 'Executive brief generation started',
      source: 'BRIEF_SCORING',
    });
  } catch (err) {
    // Non-blocking — brief generation should not fail due to stage transition errors
    console.warn('[opportunity-stage] onBriefGenerationStarted failed (non-blocking):', (err as Error)?.message);
  }
};

/**
 * Called when executive brief scoring completes.
 * Transitions based on the scoring decision:
 *   GO           → PURSUING
 *   NO_GO        → NO_BID
 *   CONDITIONAL_GO → QUALIFYING (stays, needs manual decision)
 */
export const onBriefScoringComplete = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  decision: 'GO' | 'NO_GO' | 'CONDITIONAL_GO';
  compositeScore?: number;
}): Promise<void> => {
  const { decision, compositeScore, ...location } = args;

  try {
    const existing = await getOpportunity(location);
    if (!existing) return;

    const currentStage = (existing.item.stage as OpportunityStage) ?? 'IDENTIFIED';

    // Only auto-transition from QUALIFYING or IDENTIFIED
    if (!['IDENTIFIED', 'QUALIFYING'].includes(currentStage)) return;

    if (decision === 'GO') {
      await transitionOpportunityStage({
        ...location,
        toStage: 'PURSUING',
        changedBy: 'system',
        reason: `Brief scoring: GO decision${compositeScore !== undefined ? ` (score: ${compositeScore}/5)` : ''}`,
        source: 'BRIEF_SCORING',
      });
    } else if (decision === 'NO_GO') {
      await transitionOpportunityStage({
        ...location,
        toStage: 'NO_BID',
        changedBy: 'system',
        reason: `Brief scoring: NO_GO decision${compositeScore !== undefined ? ` (score: ${compositeScore}/5)` : ''}`,
        source: 'BRIEF_SCORING',
      });
    }
    // CONDITIONAL_GO: stay in QUALIFYING, requires manual decision
  } catch (err) {
    console.warn('[opportunity-stage] onBriefScoringComplete failed (non-blocking):', (err as Error)?.message);
  }
};

/**
 * Called when a project outcome is set.
 * Maps outcome status to opportunity stage:
 *   PENDING    → SUBMITTED
 *   WON        → WON
 *   LOST       → LOST
 *   WITHDRAWN  → WITHDRAWN
 *   NO_BID     → NO_BID
 */
export const onProjectOutcomeSet = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  outcomeStatus: 'WON' | 'LOST' | 'NO_BID' | 'WITHDRAWN' | 'PENDING';
  changedBy: string;
}): Promise<void> => {
  const { outcomeStatus, changedBy, ...location } = args;

  const stageMap: Partial<Record<typeof outcomeStatus, OpportunityStage>> = {
    PENDING:   'SUBMITTED',
    WON:       'WON',
    LOST:      'LOST',
    WITHDRAWN: 'WITHDRAWN',
    NO_BID:    'NO_BID',
  };

  const toStage = stageMap[outcomeStatus];
  if (!toStage) return;

  try {
    await transitionOpportunityStage({
      ...location,
      toStage,
      changedBy,
      reason: `Project outcome set to ${outcomeStatus}`,
      source: 'PROJECT_OUTCOME',
    });
  } catch (err) {
    console.warn('[opportunity-stage] onProjectOutcomeSet failed (non-blocking):', (err as Error)?.message);
  }

  // Trigger APN registration non-blocking when stage transitions to SUBMITTED
  if (outcomeStatus === 'PENDING') {
    const { orgId, projectId, oppId } = location;
    const opp = await getOpportunity({ orgId, projectId, oppId }).catch(() => null);
    if (opp?.item) {
      triggerApnRegistration({
        orgId,
        projectId,
        oppId,
        customerName:      (opp.item.organizationName as string | undefined) ?? 'Unknown Customer',
        opportunityValue:  (opp.item.baseAndAllOptionsValue as number | undefined) ?? 0,
        awsServices:       ['Other'],
        expectedCloseDate: (opp.item.responseDeadlineIso as string | undefined) ?? new Date().toISOString(),
        proposalStatus:    'SUBMITTED',
        description:       typeof opp.item.description === 'string'
          ? opp.item.description.substring(0, 500)
          : undefined,
        registeredBy:      changedBy,
      }).catch(err =>
        console.warn('[APN] triggerApnRegistration failed (non-blocking):', (err as Error).message),
      );
    }
  }
};
