/**
 * EventBridge listener: receives POC result events from DevelopmentPlatform and
 * resolves the opportunity's POC-generation state so the "Generating…" button
 * never stays stuck.
 *
 * Source:     development-platform.poc
 * DetailType: POCDeploymentComplete | POCDeploymentFailed
 *
 * Complete detail: { oppId, orgId, projectId, pocUrl, deployedAt }
 * Failed detail:   { oppId, orgId, projectId, failureReason, failedAt, stage? }
 *
 * Behaviour:
 *  - Complete → state 'succeeded', store pocUrl/deployedAt, CLEAR any failure
 *    fields (self-heals a Failed→Complete out-of-order delivery).
 *  - Failed   → Complete-wins latch: if a live pocUrl already exists (or state is
 *    already 'succeeded'), log-and-drop. Otherwise store the reason and mark failed.
 *
 * Correlation is by the DynamoDB SK, built from orgId + projectId + oppId. All
 * three are required to locate the record — the emitter (AutoRFP) always populates
 * them. Legacy DevelopmentPlatform records may send null/"" for org/project; those
 * are treated as absent and dropped (we could not locate the record anyway).
 *
 * failureReason is free-text — stored for display only, never parsed or branched on.
 * State transitions are naturally idempotent, so at-least-once redelivery is safe.
 */

import { z } from 'zod';
import { getOpportunity, updateOpportunity } from '@/helpers/opportunity';

const POC_COMPLETE = 'POCDeploymentComplete';
const POC_FAILED = 'POCDeploymentFailed';

const POCCompleteDetailSchema = z.object({
  oppId: z.string().min(1),
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  pocUrl: z.string().url(),
  deployedAt: z.string().min(1),
});

const POCFailedDetailSchema = z.object({
  oppId: z.string().min(1),
  // org/project are best-effort: null/"" on legacy DevelopmentPlatform records.
  orgId: z.string().nullish(),
  projectId: z.string().nullish(),
  failureReason: z.string().min(1),
  failedAt: z.string().min(1),
});

interface EventBridgeEvent {
  detail: unknown;
  source: string;
  'detail-type': string;
}

const handleComplete = async (detail: unknown): Promise<void> => {
  const { success, data, error } = POCCompleteDetailSchema.safeParse(detail);
  if (!success) {
    console.error('Invalid POCDeploymentComplete detail', error.issues);
    return;
  }

  const { orgId, projectId, oppId, pocUrl, deployedAt } = data;

  // Write unconditionally — deliberately asymmetric with handleFailed's read-first
  // latch. A Complete is always safe to apply: two Completes for the same opp (a
  // re-run) are last-writer-wins, which is what we want (newest live URL), and a
  // Complete must always beat a Failed. Only Failed needs the guard.
  await updateOpportunity({
    orgId,
    projectId,
    oppId,
    patch: {
      pocUrl,
      pocDeployedAt: deployedAt,
      pocGenState: 'succeeded',
      // Clear any prior failure so a Failed→Complete ordering self-heals.
      pocFailureReason: null,
      pocFailedAt: null,
    },
  });

  console.log(`POC succeeded for opportunity ${oppId}: pocUrl=${pocUrl}`);
};

const handleFailed = async (detail: unknown): Promise<void> => {
  const { success, data, error } = POCFailedDetailSchema.safeParse(detail);
  if (!success) {
    console.error('Invalid POCDeploymentFailed detail', error.issues);
    return;
  }

  const { orgId, projectId, oppId, failureReason, failedAt } = data;

  // Correlation requires a full SK. Treat null and "" as absent.
  if (!orgId || !projectId) {
    console.warn(
      `Dropping POCDeploymentFailed for opp ${oppId}: missing orgId/projectId (cannot locate record)`,
    );
    return;
  }

  // Complete-wins latch: a live URL means the POC is usable regardless of later
  // QA/timeout churn — do not regress a working POC to "failed".
  //
  // This read-then-write has a benign TOCTOU window: if a Complete lands between
  // this read and the write below, we could still stamp pocGenState:'failed' onto
  // a record that now has a pocUrl. We intentionally do NOT guard it with a
  // ConditionExpression because the impact is nil: handleFailed never clears
  // pocUrl, and the button renders pocUrl before the failed state (see
  // opportunity-header.tsx), so the user still sees a working POC. A subsequent
  // retry Complete also self-heals the state field. Not worth bypassing the
  // shared updateOpportunity helper for this event volume.
  const existing = await getOpportunity({ orgId, projectId, oppId });
  if (!existing) {
    console.warn(`Dropping POCDeploymentFailed: opportunity ${oppId} not found`);
    return;
  }
  if (existing.item.pocUrl || existing.item.pocGenState === 'succeeded') {
    console.log(
      `Ignoring POCDeploymentFailed for opp ${oppId}: a completed POC already exists (Complete wins)`,
    );
    return;
  }

  await updateOpportunity({
    orgId,
    projectId,
    oppId,
    patch: {
      pocGenState: 'failed',
      pocFailureReason: failureReason,
      pocFailedAt: failedAt,
    },
  });

  console.log(`POC failed for opportunity ${oppId}: ${failureReason}`);
};

export const handler = async (event: EventBridgeEvent): Promise<void> => {
  const detailType = event['detail-type'];
  console.log(`Received ${detailType} event`, JSON.stringify(event.detail));

  switch (detailType) {
    case POC_COMPLETE:
      await handleComplete(event.detail);
      return;
    case POC_FAILED:
      await handleFailed(event.detail);
      return;
    default:
      console.warn(`Ignoring unexpected detail-type: ${detailType}`);
  }
};
