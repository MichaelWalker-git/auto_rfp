/**
 * solution-plan-restore.ts
 *
 * Restore-as-new orchestration (solution-plan-versioning u3, contract C2,
 * workflow W1). The pipeline is an ORDERED sequence whose only state-changing
 * step is atomic (reliability design, NFR1.16):
 *
 *   1. read plan + source version          (no side effects)
 *   2. fail-fast guards                    (no side effects; optimization only —
 *                                           C4's ConditionExpression is the
 *                                           authoritative guard, NFR1.19)
 *   3. S3 fresh SERVER-SIDE copy → NEW key (side effect: invisible object;
 *                                           the body never transits the Lambda,
 *                                           performance design NFR2.11)
 *   4. C4 conditional plan write           (THE atomic step — old→new in one
 *                                           single-item write)
 *   5. u1 capture, origin "restore"        (fail-open; the plan is already
 *                                           correct, BR3.2 / u1 BR5.1)
 *
 * Every failure leaves the plan untouched or fully restored — a pre-write
 * failure's worst residue is ONE orphaned S3 object referenced by nothing
 * (accepted, no cleanup; NFR1.17). No server-side retry of the pipeline (a
 * completed run is not idempotent at the history level), no rollback, no
 * compensation. Concurrency is last-write-wins (BR4.1 — human ruling Q6).
 */

import type {
  SolutionPlanDBItem,
  SolutionPlanKey,
  SolutionPlanVersionListItem,
} from '@auto-rfp/core';

import { isConditionalCheckFailed } from './db';
import { copyS3Object } from './s3';
import { requireEnv } from './env';
import {
  buildSolutionPlanHtmlKey,
  getSolutionPlanByOpportunity,
  restoreSolutionPlanContent,
} from './solution-plan';
import {
  captureSolutionPlanVersion,
  getSolutionPlanVersion,
  listSolutionPlanVersions,
  toSolutionPlanVersionListItem,
} from './solution-plan-version';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

export type RestoreSolutionPlanVersionInput = {
  key: SolutionPlanKey;
  /** Source version to restore — an opaque lookup token, NEVER a key fragment (NFR3.11). */
  versionId: string;
  /** Server-derived user id of the restoring caller (NFR3.12 — never from the body). */
  restoredBy: string;
  /** Display name matching `restoredBy` (claims.name ?? claims.email precedent). */
  restoredByName?: string;
  /** Correlation id for the completion event (Lambda request id, NFR1.21). */
  requestId?: string;
};

/**
 * Typed outcome union the handler maps to C2 status codes: SOURCE_NOT_FOUND →
 * 404, CURRENT_VERSION / GENERATING → 409, RESTORED → 200. Guard outcomes are
 * expected behavior — RETURNED, never thrown (NFR1.22).
 */
export type RestoreSolutionPlanVersionResult =
  | {
      outcome: 'RESTORED';
      /** The restore's own history row — null when capture failed fail-open (C2 envelope). */
      newVersion: SolutionPlanVersionListItem | null;
    }
  /** Source version (or the plan itself) vanished — nothing read is mutated (BR2.3). */
  | { outcome: 'SOURCE_NOT_FOUND' }
  /** The source is the NEWEST history record — a no-op restore is refused (BR2.1). */
  | { outcome: 'CURRENT_VERSION' }
  /** Plan generation in flight — pre-check or C4's atomic condition (BR2.2, NFR1.19). */
  | { outcome: 'GENERATING' };

/** A generation run is in flight unless the plan is READY or FAILED (C4 allow-list mirror). */
const isPlanGenerating = (plan: SolutionPlanDBItem): boolean =>
  plan.status !== 'READY' && plan.status !== 'FAILED';

/**
 * Execute the W1 restore pipeline. Guard rejections come back as outcome
 * values; unexpected storage errors (S3 copy 500s, non-conditional DynamoDB
 * failures) PROPAGATE to the caller — `withSentryLambda` reports them
 * (reliability design, failure-mode ledger).
 */
export const restoreSolutionPlanVersion = async (
  input: RestoreSolutionPlanVersionInput,
): Promise<RestoreSolutionPlanVersionResult> => {
  const startedAt = Date.now();
  const { key, versionId, restoredBy } = input;

  // ── 1. Reads (no side effects) ──
  const plan = await getSolutionPlanByOpportunity(key);
  if (!plan) return { outcome: 'SOURCE_NOT_FOUND' };

  const source = await getSolutionPlanVersion(key, versionId);
  if (!source) return { outcome: 'SOURCE_NOT_FOUND' };

  // ── 2. Fail-fast guards (cheap rejection BEFORE the S3 copy is paid for;
  //       the C4 condition below is the authoritative status guard) ──
  const [newest] = await listSolutionPlanVersions(key); // newest first
  if (newest?.versionId === versionId) return { outcome: 'CURRENT_VERSION' };
  if (isPlanGenerating(plan)) return { outcome: 'GENERATING' };

  // ── 3. Fresh server-side copy to a NEW server-generated key (BR1.1) ──
  // Destination follows the existing plan-content v{n} convention for the
  // plan's next counter value — derived server-side from the plan record we
  // read, never from client input, never aliasing the source's key (NFR3.11).
  const destinationKey = buildSolutionPlanHtmlKey(key, plan.version + 1);
  await copyS3Object(DOCUMENTS_BUCKET, source.htmlContentKey, destinationKey);

  // ── 4. C4 conditional plan write — THE atomic step ──
  let updated: SolutionPlanDBItem;
  try {
    updated = await restoreSolutionPlanContent({
      key,
      htmlContentKey: destinationKey,
      costSchedule: source.costScheduleSnapshot ?? null,
      restoredBy,
    });
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      // A generation started between the pre-check and the write (or the plan
      // vanished) — the same business outcome caught at the authoritative
      // layer. The plan is untouched; the fresh copy is harmless orphaned
      // garbage (NFR1.17). Never an ERROR/Sentry event (NFR1.22).
      return { outcome: 'GENERATING' };
    }
    throw err;
  }

  // ── 5. Capture the restore's own version (origin "restore", BR3.1) ──
  // Fail-open per u1's BR5.1: a capture failure does NOT undo the restore —
  // the response then carries newVersion: null (C2-compatible envelope).
  const captured = await captureSolutionPlanVersion({
    key,
    solutionPlanId: updated.id,
    versionNumber: updated.version,
    htmlContentKey: destinationKey,
    costScheduleSnapshot: source.costScheduleSnapshot ?? null,
    origin: 'restore',
    createdBy: restoredBy,
    createdByName: input.restoredByName,
  });
  const newVersion = captured ? toSolutionPlanVersionListItem(captured) : null;

  // ── 6. Completion event — the feature's audit record (NFR1.21) ──
  console.info(
    JSON.stringify({
      event: 'solution_plan_restore_completed',
      ...key,
      sourceVersionId: source.versionId,
      sourceVersionNumber: source.versionNumber,
      newVersionId: newVersion?.versionId ?? null,
      restoredBy,
      latencyMs: Date.now() - startedAt,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }),
  );

  return { outcome: 'RESTORED', newVersion };
};
