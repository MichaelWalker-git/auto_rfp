/**
 * ACE (AWS Partner Central) stage helpers for the RFP-tracking board.
 *
 * The ACE stage is a third axis alongside `status` and `approvalStatus`:
 * gate-1 approve sets it to 'Prospect' (and creates the Partner Central
 * opportunity); afterwards it is driven manually from the board dropdown and
 * each change is pushed to Partner Central. All seven stages are freely
 * selectable — there is no allowed-transition map.
 */

import { nowIso } from '@/helpers/date';
import { getOpportunity, updateOpportunity } from '@/helpers/opportunity';
import { syncOpportunityToApn } from '@/helpers/apn-db';
import type { UserContext } from '@/helpers/db';
import type { AceStage, AceStageTransition, OpportunityItem } from '@auto-rfp/core';

export interface AceStageLocalArgs {
  orgId: string;
  projectId: string;
  oppId: string;
  to: AceStage;
  changedBy: string;
  source: AceStageTransition['source'];
  userContext?: UserContext;
}

/**
 * Set the opportunity's ACE stage locally: appends an AceStageTransition to
 * aceStageHistory and persists both fields. Returns the updated item.
 *
 * @throws Error when the opportunity is not found.
 */
export const setAceStageLocal = async (args: AceStageLocalArgs): Promise<OpportunityItem> => {
  const { orgId, projectId, oppId, to, changedBy, source, userContext } = args;

  const existing = await getOpportunity({ orgId, projectId, oppId });
  if (!existing) {
    throw new Error(`Opportunity not found: orgId=${orgId}, projectId=${projectId}, oppId=${oppId}`);
  }

  const from = (existing.item.aceStage as AceStage | undefined) ?? null;

  const transition: AceStageTransition = {
    from,
    to,
    changedAt: nowIso(),
    changedBy,
    source,
  };

  const existingHistory =
    (existing.item.aceStageHistory as AceStageTransition[] | undefined) ?? [];

  const { item } = await updateOpportunity({
    orgId,
    projectId,
    oppId,
    patch: {
      aceStage: to,
      aceStageHistory: [...existingHistory, transition],
    },
    userContext,
  });

  console.log(
    `[ace-stage] ${from ?? '(none)'} → ${to} for oppId=${oppId} (source=${source}, changedBy=${changedBy})`,
  );

  return item as OpportunityItem;
};

export interface AceStageSyncArgs {
  orgId: string;
  projectId: string;
  oppId: string;
  /** The opportunity as it stands (post local write) — source of PC fields. */
  item: OpportunityItem;
  aceStage: AceStage;
}

/**
 * Push the ACE stage to Partner Central. Creates the PC opportunity when the
 * item has no apnOpportunityId yet (e.g. right after gate-1 approve), updates
 * otherwise. Never throws — success/error is persisted on the item as
 * apnOpportunityId/apnSyncError by the APN client.
 *
 * Returns whether the item shows no sync error after the attempt.
 */
export const syncAceStageToPartnerCentral = async (args: AceStageSyncArgs): Promise<boolean> => {
  const { orgId, projectId, oppId, item, aceStage } = args;

  try {
    await syncOpportunityToApn({
      orgId,
      projectId,
      oppId,
      customerName: item.organizationName ?? item.title ?? 'Unknown Customer',
      opportunityTitle: item.title,
      opportunityValue: item.baseAndAllOptionsValue ?? 0,
      expectedCloseDate: item.responseDeadlineIso ?? nowIso(),
      proposalStatus: 'PROSPECT',
      description: item.description?.substring(0, 500) ?? undefined,
      existingApnId: item.apnOpportunityId ?? null,
      aceStage,
    });

    // The APN client wrote the outcome onto the item — re-read to report it.
    const after = await getOpportunity({ orgId, projectId, oppId });
    return Boolean(after && !after.item.apnSyncError && after.item.apnOpportunityId);
  } catch (err) {
    console.error(
      `[ace-stage] Partner Central sync failed for oppId=${oppId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
};

/**
 * Outcome of an attempt to bring an opportunity's ACE stage to
 * 'Technical Validation':
 *   - 'created'  — the ACE stage was set and no Partner Central opportunity
 *                  existed before (a new PC opp is created by the sync push).
 *   - 'advanced' — the ACE stage was set and a PC opportunity already existed
 *                  (its lifecycle stage is updated).
 *   - 'skipped'  — already at 'Technical Validation' AND the Partner Central
 *                  opportunity already exists (idempotent no-op).
 *   - 'error'    — the opportunity was missing or a local write threw.
 *
 * Note: a record at 'Technical Validation' locally but WITHOUT an
 * apnOpportunityId (a prior PC push failed) is NOT skipped — the push is
 * retried and the result is 'created'/'advanced'.
 */
export type AceTechnicalValidationOutcome = 'created' | 'advanced' | 'skipped' | 'error';

export interface EnsureAceTechnicalValidationArgs {
  orgId: string;
  projectId: string;
  oppId: string;
  /** Attribution for the stage transition. Defaults to 'system'. */
  changedBy?: string;
  /** Provenance recorded on the transition. Defaults to 'AUTO_SUBMITTED'. */
  source?: AceStageTransition['source'];
}

/**
 * Best-effort: bring an opportunity's ACE stage to 'Technical Validation',
 * creating (or updating) the Partner Central opportunity. Used by the "RFP
 * marked submitted" auto-trigger (Linear sync) and the one-off backfill.
 *
 * Idempotent: a no-op when the opportunity is already at 'Technical Validation'
 * AND already has a Partner Central opportunity. If the stage is set locally but
 * the PC opportunity is missing (an earlier push failed), the push is retried.
 * The Partner Central push itself is idempotent (ClientToken = `${orgId}-${oppId}`)
 * and non-blocking, so re-runs never create a duplicate PC opportunity.
 *
 * NEVER throws — a missing opportunity or a DynamoDB failure is caught and
 * reported as 'error' so callers (a scheduled sync, a batch backfill) keep going.
 */
export const ensureAceTechnicalValidation = async (
  args: EnsureAceTechnicalValidationArgs,
): Promise<AceTechnicalValidationOutcome> => {
  const { orgId, projectId, oppId, changedBy = 'system', source = 'AUTO_SUBMITTED' } = args;

  try {
    const existing = await getOpportunity({ orgId, projectId, oppId });
    if (!existing) {
      console.error(`[ace-stage] ensureAceTechnicalValidation: opportunity not found oppId=${oppId}`);
      return 'error';
    }

    const item = existing.item as OpportunityItem;
    const hadApnId = Boolean(item.apnOpportunityId);
    const alreadyAtStage = item.aceStage === 'Technical Validation';

    // Idempotent skip — but only once the Partner Central opportunity actually
    // exists. If the stage was set locally on a prior run yet the PC push failed
    // (no apnOpportunityId), retry the push instead of stranding the record.
    if (alreadyAtStage && hadApnId) return 'skipped';

    // Re-push without re-appending history when the stage is already correct
    // locally; only write a new transition when the stage actually changes.
    const itemForSync = alreadyAtStage
      ? item
      : await setAceStageLocal({
          orgId,
          projectId,
          oppId,
          to: 'Technical Validation',
          changedBy,
          source,
        });

    await syncAceStageToPartnerCentral({
      orgId,
      projectId,
      oppId,
      item: itemForSync,
      aceStage: 'Technical Validation',
    });

    return hadApnId ? 'advanced' : 'created';
  } catch (err) {
    console.error(
      `[ace-stage] ensureAceTechnicalValidation failed for oppId=${oppId}:`,
      err instanceof Error ? err.message : err,
    );
    return 'error';
  }
};
