/**
 * SQS worker for the Solution Plan grilling loop (T6).
 *
 * Thin handler: validate each queue message and dispatch to the phase
 * processor in `@/helpers/solution-plan-worker`. All business logic —
 * runId guards, idempotency, model turns, FAILED handling — lives there.
 *
 * The queue uses batchSize 1 + `reportBatchItemFailures`; a failed record is
 * reported (→ DLQ at maxReceiveCount 1), a malformed record is dropped since
 * redelivering it can never succeed.
 */

import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

import { withSentryLambda } from '@/sentry-lambda';
import { GrillingRoundMessageSchema } from '@/helpers/solution-plan-queue';
import {
  errorMessageOf,
  processGrillingRound,
  processSynthesis,
} from '@/helpers/solution-plan-worker';

/** Process one SQS record body. Exported for direct testing. */
export const processSolutionPlanRecord = async (body: string): Promise<void> => {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    console.error('[solution-plan-worker-handler] dropping non-JSON message body');
    return;
  }

  const { success, data, error } = GrillingRoundMessageSchema.safeParse(raw);
  if (!success) {
    console.error(
      '[solution-plan-worker-handler] dropping invalid message:',
      JSON.stringify(error.issues),
    );
    return;
  }

  if (data.phase === 'SYNTHESIZE') {
    await processSynthesis(data);
  } else {
    await processGrillingRound(data);
  }
};

/** Exported for direct testing — `handler` below is the Sentry-wrapped export. */
export const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      await processSolutionPlanRecord(record.body);
    } catch (err) {
      console.error(
        `[solution-plan-worker-handler] record ${record.messageId} failed:`,
        errorMessageOf(err),
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
