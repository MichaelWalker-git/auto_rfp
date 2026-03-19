/**
 * SQS Worker: RFP Document Generation
 *
 * Processes document generation jobs from the SQS queue. Supports two generation
 * strategies based on whether a template exists:
 *
 * 1. Template with <h2> sections → Section-by-section generation
 * 2. Simple template / no template → Single-shot generation with tool-use loop
 *
 * All business logic lives in `@/helpers/generate-document-worker`.
 */

import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

import { withSentryLambda } from '@/sentry-lambda';
import { updateDocumentStatus } from '@/helpers/document-generation';
import { JobSchema, processJobInner, type Job } from '@/helpers/generate-document-worker';

// ─── Process Job (error boundary) ─────────────────────────────────────────────

const processJob = async (job: Job): Promise<void> => {
  const { projectId, opportunityId, documentId, documentType, orgId } = job;

  console.log(`Processing document generation: documentId=${documentId}, type=${documentType}, orgId=${orgId}`);

  try {
    await processJobInner(job);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[FATAL] processJob failed for documentId=${documentId}:`, errorMessage, err);

    // Always mark the document as FAILED so it doesn't stay stuck in GENERATING
    try {
      await updateDocumentStatus(
        projectId, opportunityId, documentId, 'FAILED',
        undefined, `Generation failed: ${errorMessage.substring(0, 500)}`,
      );
      console.log(`Marked documentId=${documentId} as FAILED`);
    } catch (statusErr) {
      console.error(`[FATAL] Failed to mark documentId=${documentId} as FAILED:`, (statusErr as Error)?.message);
    }

    throw err;
  }
};

// ─── SQS Handler ──────────────────────────────────────────────────────────────

const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    let job: Job | null = null;
    try {
      job = JobSchema.parse(JSON.parse(record.body));
      await processJob(job);
    } catch (err) {
      const errorMessage = (err as Error)?.message ?? 'Unknown error';
      console.error(
        `Failed to process document generation message ${record.messageId}:`,
        errorMessage,
      );

      // Mark the document as FAILED so it doesn't stay stuck in GENERATING forever
      if (job) {
        try {
          await updateDocumentStatus(
            job.projectId, job.opportunityId, job.documentId, 'FAILED',
            undefined, `Generation failed: ${errorMessage.substring(0, 500)}`,
          );
        } catch (statusErr) {
          console.error('Failed to update document status to FAILED:', (statusErr as Error)?.message);
        }
      }

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
