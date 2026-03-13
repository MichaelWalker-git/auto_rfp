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
import { STAGE_TO_APN_STATUS_MAP } from '@/constants/apn';
import { buildOpportunitySk, getOpportunity } from '@/helpers/opportunity';
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

  // Sync to AWS Partner Central when stage changes to SUBMITTED, WON, or LOST
  const apnSyncStages: OpportunityStage[] = ['SUBMITTED', 'WON', 'LOST', 'NO_BID', 'WITHDRAWN'];
  if (apnSyncStages.includes(toStage)) {
    const proposalStatus = STAGE_TO_APN_STATUS_MAP[toStage];

    // APN sync (awaited to prevent Lambda termination before completion)
    const { syncOpportunityToApn } = await import('@/helpers/apn-db');
    await syncOpportunityToApn({
      orgId,
      projectId,
      oppId,
      customerName:      (res.Attributes?.organizationName as string | undefined) ?? 'Unknown Customer',
      opportunityTitle:  (res.Attributes?.title as string | undefined) ?? 'Untitled Opportunity',
      opportunityValue:  (res.Attributes?.baseAndAllOptionsValue as number | undefined) ?? 0,
      expectedCloseDate: (res.Attributes?.responseDeadlineIso as string | undefined) ?? new Date().toISOString(),
      proposalStatus,
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
 * This is a true fire-and-forget operation that returns immediately.
 */
export const onBriefGenerationStarted = (args: {
  orgId: string;
  projectId: string;
  oppId: string;
}): void => {
  // Fire-and-forget: start async work but don't return a Promise
  (async () => {
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
  })();
};

/**
 * Called when executive brief scoring completes.
 * Transitions based on the scoring decision:
 *   GO           → PURSUING
 *   NO_GO        → NO_BID
 *   CONDITIONAL_GO → QUALIFYING (stays, needs manual decision)
 * This is a true fire-and-forget operation that returns immediately.
 */
export const onBriefScoringComplete = (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  decision: 'GO' | 'NO_GO' | 'CONDITIONAL_GO';
  compositeScore?: number;
}): void => {
  const { decision, compositeScore, ...location } = args;

  // Fire-and-forget: start async work but don't return a Promise
  (async () => {
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
  })();
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

  console.log(`[onProjectOutcomeSet] Called with:`, {
    orgId: location.orgId,
    projectId: location.projectId,
    oppId: location.oppId,
    outcomeStatus,
    changedBy,
  });

  const stageMap: Partial<Record<typeof outcomeStatus, OpportunityStage>> = {
    PENDING:   'SUBMITTED',
    WON:       'WON',
    LOST:      'LOST',
    WITHDRAWN: 'WITHDRAWN',
    NO_BID:    'NO_BID',
  };

  const toStage = stageMap[outcomeStatus];
  if (!toStage) {
    console.warn(`[onProjectOutcomeSet] No stage mapping for outcomeStatus: ${outcomeStatus}`);
    return;
  }

  console.log(`[onProjectOutcomeSet] Transitioning opportunity ${location.oppId} to stage: ${toStage}`);

  try {
    await transitionOpportunityStage({
      ...location,
      toStage,
      changedBy,
      reason: `Project outcome set to ${outcomeStatus}`,
      source: 'PROJECT_OUTCOME',
    });
    console.log(`[onProjectOutcomeSet] Successfully transitioned opportunity ${location.oppId} to ${toStage}`);
  } catch (err) {
    console.error(`[onProjectOutcomeSet] transitionOpportunityStage failed for oppId=${location.oppId}:`, (err as Error)?.message);
    console.error(`[onProjectOutcomeSet] Full error:`, err);
    // Preserve fire-and-forget behavior: log the error but do not propagate it to callers
  }

  // APN sync is handled inside transitionOpportunityStage in a non-blocking .catch() chain
  // Only stage transition errors are logged above; APN failures don't surface here
  console.log(`[onProjectOutcomeSet] APN sync is triggered inside transitionOpportunityStage (non-blocking)`);
};
