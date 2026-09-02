import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { withSentryLambda } from '@/sentry-lambda';
import { RenameChunksJobSchema } from '@/helpers/rename-chunks-queue';
import { updateChunkDocumentNameInPinecone } from '@/helpers/pinecone';

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
    try {
      const rawBody = JSON.parse(record.body);
      const job = RenameChunksJobSchema.parse(rawBody);

      console.log(`Processing rename-chunks job for sk=${job.sk} (${job.chunkCount} chunks)`);

      await updateChunkDocumentNameInPinecone(job.orgId, job.sk, job.chunkCount, job.textFileKey, job.documentName);

      console.log(`Completed rename-chunks job for sk=${job.sk}`);
    } catch (err) {
      console.error(
        `Failed to process rename-chunks message ${record.messageId}:`,
        err instanceof Error ? err.message : err,
      );
      // Individual chunk failures are already logged by updateChunkDocumentNameInPinecone;
      // marking the whole job for retry re-runs it (idempotent — every chunk update is a
      // metadata overwrite, not an append).
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
