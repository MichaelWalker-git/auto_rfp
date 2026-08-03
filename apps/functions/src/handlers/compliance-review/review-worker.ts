/**
 * SQS worker for the async full-package compliance review.
 *
 * Not an API handler — invoked from the compliance-review queue. Uses a
 * Sonnet-class model (no 29s limit) to review the whole package, validates
 * findings, and writes the result to the run. On failure the run is marked
 * FAILED; an uncaught throw lets SQS retry / DLQ.
 */
import type { SQSEvent } from 'aws-lambda';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { runFullReview } from '@/helpers/compliance-review-engine';
import { getReviewRunById, markRunFailed, markRunReady } from '@/helpers/compliance-review';
import { writeComplianceAuditLog } from '@/helpers/compliance-review-audit';

const WORKER_MODEL_ID = requireEnv(
  'COMPLIANCE_REVIEW_WORKER_MODEL_ID',
  'us.anthropic.claude-sonnet-4-6',
);

const JobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  reviewId: z.string().min(1),
});

const processRecord = async (body: string): Promise<void> => {
  const { success, data, error } = JobSchema.safeParse(JSON.parse(body));
  if (!success) {
    console.error('[compliance-review-worker] invalid job, dropping:', error.issues);
    return; // malformed job — don't retry
  }
  const { orgId, projectId, oppId, reviewId } = data;

  const run = await getReviewRunById(orgId, projectId, oppId, reviewId);
  if (!run) {
    console.error(`[compliance-review-worker] run ${reviewId} not found, dropping`);
    return;
  }
  if (run.status !== 'RUNNING') {
    console.log(`[compliance-review-worker] run ${reviewId} already ${run.status}, skipping`);
    return;
  }

  try {
    const { findings } = await runFullReview({
      orgId,
      projectId,
      oppId,
      modelId: WORKER_MODEL_ID,
    });
    await markRunReady(run, findings);
    console.log(`[compliance-review-worker] run ${reviewId} READY with ${findings.length} finding(s)`);

    // Audit: a full AI review completed. System-actor (async worker).
    await writeComplianceAuditLog({
      action: 'COMPLIANCE_REVIEW_COMPLETED',
      resource: 'compliance_review_run',
      resourceId: reviewId,
      orgId,
      after: { oppId, projectId, trigger: run.trigger, findingsCount: findings.length },
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Unknown error';
    console.error(`[compliance-review-worker] run ${reviewId} failed:`, message);
    await markRunFailed(run, message).catch((e) =>
      console.error('[compliance-review-worker] failed to mark run FAILED:', (e as Error)?.message),
    );

    // Audit: the review failed. Recorded before re-throwing so the failure is
    // logged even though the message goes back to the queue / DLQ.
    await writeComplianceAuditLog({
      action: 'COMPLIANCE_REVIEW_FAILED',
      resource: 'compliance_review_run',
      resourceId: reviewId,
      orgId,
      result: 'failure',
      errorMessage: message,
      after: { oppId, projectId, trigger: run.trigger },
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
