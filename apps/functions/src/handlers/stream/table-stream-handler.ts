import type { DynamoDBStreamHandler, DynamoDBBatchResponse } from 'aws-lambda';
import { withSentryLambda } from '@/sentry-lambda';
import { archiveRemovedAuditLog } from '@/helpers/audit-archive';
import { detectNewMember } from '@/helpers/member-detection';

/**
 * Single consumer of the main table's DynamoDB stream. Thin dispatcher only —
 * all logic lives in the two service helpers:
 *   - REMOVE  → archiveRemovedAuditLog (compliance archival; rethrows on failure)
 *   - INSERT  → detectNewMember        (member-detection alert; best-effort, never throws)
 *
 * Returns a partial-batch response so a single failing record fails only itself.
 * Without this, a failing REMOVE would retry the whole batch and re-run
 * detectNewMember on every successful INSERT — double-firing detection alerts.
 */
const baseHandler: DynamoDBStreamHandler = async (event): Promise<DynamoDBBatchResponse> => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      if (record.eventName === 'REMOVE') {
        await archiveRemovedAuditLog(record);
      } else if (record.eventName === 'INSERT') {
        await detectNewMember(record);
      }
    } catch (err) {
      console.error('[table-stream-handler] Record failed, reporting for retry:', err);
      const id = record.dynamodb?.SequenceNumber;
      if (id) batchItemFailures.push({ itemIdentifier: id });
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
