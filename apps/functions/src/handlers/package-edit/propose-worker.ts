/**
 * SQS worker for the async cross-package edit proposal scan.
 *
 * Not an API handler — invoked from the package-edit queue. Uses a Sonnet-class
 * model (no 29s limit) to scan the whole package, draft + validate every
 * before→after proposal, and mark the run PROPOSED. On failure the run is marked
 * FAILED and the message is re-thrown so SQS retries / DLQs (visibility for a
 * doomed long job; the DLQ maxReceiveCount is 1 — we don't re-run a doomed scan).
 *
 * Clone of compliance-review/review-worker.ts.
 */
import type { SQSEvent } from 'aws-lambda';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { runProposeEdits } from '@/helpers/package-edit-engine';
import { getProposalRunById, markRunFailed, markRunProposed } from '@/helpers/package-edit';
import { writePackageEditAuditLog } from '@/helpers/package-edit-audit';

const WORKER_MODEL_ID = requireEnv(
  'PACKAGE_EDIT_WORKER_MODEL_ID',
  'us.anthropic.claude-sonnet-4-6',
);

const JobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  runId: z.string().min(1),
});

const processRecord = async (body: string): Promise<void> => {
  // Parse inside the guard: a non-JSON body would otherwise throw here and
  // propagate out, re-driving/DLQing a poison message we intend to just drop.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    console.error('[package-edit-worker] non-JSON job body, dropping');
    return; // poison message — don't retry
  }
  const { success, data, error } = JobSchema.safeParse(parsed);
  if (!success) {
    console.error('[package-edit-worker] invalid job, dropping:', error.issues);
    return; // malformed job — don't retry
  }
  const { orgId, projectId, oppId, runId } = data;

  const run = await getProposalRunById(orgId, projectId, oppId, runId);
  if (!run) {
    console.error(`[package-edit-worker] run ${runId} not found, dropping`);
    return;
  }
  if (run.status !== 'PROPOSING') {
    console.log(`[package-edit-worker] run ${runId} already ${run.status}, skipping`);
    return; // idempotent
  }

  try {
    const { proposals, unmatched, requested, answer } = await runProposeEdits({
      orgId,
      projectId,
      oppId,
      modelId: WORKER_MODEL_ID,
      instruction: run.instruction,
    });

    // Build a truthful summary for the "0 proposals" case so the UI never shows a
    // misleading "no changes needed": distinguish "value not found" from "model
    // proposed nothing".
    let summary: string | undefined;
    if (proposals.length === 0) {
      if (unmatched.length > 0) {
        summary =
          `Couldn't find ${unmatched.map((u) => `"${u}"`).join(', ')} in the package, so nothing was changed. ` +
          `Check the current value and try again.`;
      } else if (requested === 0) {
        summary =
          answer?.trim() ||
          `No matching text was identified for that request. Try naming the exact current value to change.`;
      }
    }

    await markRunProposed(run, proposals, summary);
    console.log(
      `[package-edit-worker] run ${runId} PROPOSED with ${proposals.length} proposal(s)` +
        (unmatched.length ? ` (${unmatched.length} unmatched: ${unmatched.join(', ')})` : ''),
    );

    await writePackageEditAuditLog({
      action: 'PACKAGE_EDIT_PROPOSAL_COMPLETED',
      resource: 'package_edit_run',
      resourceId: runId,
      orgId,
      after: { oppId, projectId, proposalCount: proposals.length, unmatchedCount: unmatched.length },
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Unknown error';
    console.error(`[package-edit-worker] run ${runId} failed:`, message);
    await markRunFailed(run, message).catch((e) =>
      console.error('[package-edit-worker] failed to mark run FAILED:', (e as Error)?.message),
    );

    await writePackageEditAuditLog({
      action: 'PACKAGE_EDIT_PROPOSAL_FAILED',
      resource: 'package_edit_run',
      resourceId: runId,
      orgId,
      result: 'failure',
      errorMessage: message,
      after: { oppId, projectId },
    });

    // Re-throw so the message returns to the queue / DLQ for visibility.
    throw err;
  }
};

const baseHandler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    await processRecord(record.body);
  }
};

export const handler = withSentryLambda(baseHandler);
