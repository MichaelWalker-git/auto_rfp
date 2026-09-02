import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { withSentryLambda } from '@/sentry-lambda';
import { RenameChunksJob, RenameChunksJobSchema } from '@/helpers/rename-chunks-queue';
import { updateChunkDocumentNameInPinecone } from '@/helpers/pinecone';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';

// Non-blocking audit log — same pattern as apps/functions/src/handlers/extraction/extraction-worker.ts.
const auditRenameChunksJob = (
  job: RenameChunksJob,
  result: 'success' | 'failure',
  errorMessage?: string,
): void => {
  getHmacSecret()
    .then((hmacSecret) =>
      writeAuditLog(
        {
          logId: uuidv4(),
          timestamp: nowIso(),
          userId: 'system',
          userName: 'system',
          organizationId: job.orgId,
          action: 'DOCUMENT_RENAMED',
          resource: 'document',
          resourceId: job.id,
          changes: { after: { sk: job.sk, chunkCount: job.chunkCount } },
          ipAddress: '0.0.0.0',
          userAgent: 'system',
          result,
          ...(errorMessage ? { errorMessage } : {}),
        },
        hmacSecret,
      ).catch((err) => console.warn('Failed to write audit log:', err.message)),
    )
    .catch((err) => console.warn('Failed to get HMAC secret for audit:', err.message));
};

/**
 * SQS worker for ticket 04. Drains rename-chunks jobs enqueued by
 * `updateDocument` for documents with more than 1 000 chunks, running the
 * Pinecone chunk-metadata update loop off the request path. The DDB row is
 * already authoritative by the time a job lands here; citations may lag until
 * this finishes.
 */
export const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    let job: RenameChunksJob | undefined;
    try {
      job = RenameChunksJobSchema.parse(JSON.parse(record.body));

      console.log(`Processing rename-chunks job for sk=${job.sk} (${job.chunkCount} chunks)`);

      await updateChunkDocumentNameInPinecone(job.orgId, job.sk, job.chunkCount, job.textFileKey, job.documentName);

      console.log(`Completed rename-chunks job for sk=${job.sk}`);
      auditRenameChunksJob(job, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to process rename-chunks message ${record.messageId}:`, message);

      // Individual chunk failures are already logged by updateChunkDocumentNameInPinecone;
      // marking the whole job for retry re-runs it (idempotent — every chunk update is a
      // metadata overwrite, not an append).
      batchItemFailures.push({ itemIdentifier: record.messageId });

      // Job payload itself may have failed to parse — nothing identifiable to audit then.
      if (job) auditRenameChunksJob(job, 'failure', message);
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
