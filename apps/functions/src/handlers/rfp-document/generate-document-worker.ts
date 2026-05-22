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
 *
 * Retry Logic:
 * - After generation, validates content quality (not empty, not placeholder-only)
 * - If validation fails, retries up to MAX_GENERATION_RETRIES times with delay
 * - Sends notification to user when all retries exhausted
 */

import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import { withSentryLambda } from '@/sentry-lambda';
import {
  updateDocumentStatus,
  validateGeneratedContent,
  calculateRetryDelay,
} from '@/helpers/document-generation';
import { MAX_GENERATION_RETRIES } from '@auto-rfp/core';
import { getRFPDocument, updateRFPDocumentMetadata, loadRFPDocumentHtml } from '@/helpers/rfp-document';
import { JobSchema, processJobInner, type Job } from '@/helpers/generate-document-worker';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { RFP_DOCUMENT_TYPES } from '@auto-rfp/core';

const sqs = new SQSClient({});
const DOCUMENT_GENERATION_QUEUE_URL = process.env.DOCUMENT_GENERATION_QUEUE_URL || '';

// S3 read retry configuration for validation step
const MAX_S3_READ_RETRIES = 3;
const S3_RETRY_BASE_DELAY_MS = 1000; // Exponential backoff: 1s, 2s, 4s

/**
 * Validate that the SQS queue URL is configured before attempting to enqueue.
 * Throws if not configured to fail fast rather than silently failing.
 */
const validateQueueConfiguration = (): void => {
  if (!DOCUMENT_GENERATION_QUEUE_URL) {
    throw new Error('DOCUMENT_GENERATION_QUEUE_URL not configured - cannot enqueue retry');
  }
};

// ─── Retry Helpers ────────────────────────────────────────────────────────────

/**
 * Enqueue a retry for the current job with delay.
 * Updates document status to RETRYING and clears invalid content.
 */
const enqueueRetry = async (job: Job, currentRetryCount: number): Promise<void> => {
  // Fail fast if queue URL is not configured
  validateQueueConfiguration();

  const { projectId, opportunityId, documentId } = job;
  const newRetryCount = currentRetryCount + 1;

  // Calculate exponential backoff delay: 30s, 60s, 120s
  const delaySeconds = calculateRetryDelay(newRetryCount);

  // Update document status to RETRYING and clear the invalid content so user doesn't see it
  await updateRFPDocumentMetadata({
    projectId,
    opportunityId,
    documentId,
    updates: {
      status: 'RETRYING',
      retryCount: newRetryCount,
      generationError: `Retry attempt ${newRetryCount}/${MAX_GENERATION_RETRIES}`,
      // Clear BOTH content fields so UI doesn't show "AI Generated" badge during retry
      // Use null to clear (undefined skips the update)
      htmlContentKey: null, // Clear S3 key
      content: null, // Clear inline content metadata
    },
    updatedBy: 'system',
  });

  console.log(`[retry] Enqueueing retry ${newRetryCount}/${MAX_GENERATION_RETRIES} for documentId=${documentId} with ${delaySeconds}s delay (exponential backoff)`);

  // Re-enqueue with delay
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: DOCUMENT_GENERATION_QUEUE_URL,
      MessageBody: JSON.stringify(job),
      DelaySeconds: delaySeconds,
    }),
  );
};

/**
 * Mark document as permanently failed after all retries exhausted.
 * Sends notification to the user who triggered the generation.
 */
const markAsPermanentlyFailed = async (job: Job, failureReason: string): Promise<void> => {
  const { orgId, projectId, opportunityId, documentId, documentType } = job;

  // Get the document to find who created it
  const doc = await getRFPDocument(projectId, opportunityId, documentId);
  const createdBy = doc?.createdBy ?? undefined;

  // Update document status to FAILED
  await updateRFPDocumentMetadata({
    projectId,
    opportunityId,
    documentId,
    updates: {
      status: 'FAILED',
      generationError: `Generation failed after ${MAX_GENERATION_RETRIES} attempts: ${failureReason}`,
    },
    updatedBy: 'system',
  });

  console.log(`[retry] Document ${documentId} marked as permanently FAILED: ${failureReason}`);

  // Send notification to the user who triggered generation
  if (createdBy) {
    try {
      const documentTypeName = RFP_DOCUMENT_TYPES[documentType as keyof typeof RFP_DOCUMENT_TYPES]
        || documentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

      const payload = buildNotification(
        'DOCUMENT_GENERATION_FAILED',
        'Document Generation Failed',
        `Failed to generate "${documentTypeName}" after ${MAX_GENERATION_RETRIES} attempts. ${failureReason}`,
        {
          orgId,
          projectId,
          entityId: documentId,
          recipientUserIds: [createdBy],
        },
      );

      await sendNotification(payload);
      console.log(`[retry] Sent failure notification to user ${createdBy} for documentId=${documentId}`);
    } catch (notifyErr) {
      console.error(`[retry] Failed to send notification:`, (notifyErr as Error)?.message);
    }
  } else {
    console.warn(`[retry] No createdBy found for documentId=${documentId}, skipping notification`);
  }
};

// ─── Process Job (error boundary + retry logic) ───────────────────────────────

const processJob = async (job: Job): Promise<void> => {
  const { projectId, opportunityId, documentId, documentType, orgId } = job;

  console.log(`Processing document generation: documentId=${documentId}, type=${documentType}, orgId=${orgId}`);

  // Get current document to check retry count and existing content
  const existingDoc = await getRFPDocument(projectId, opportunityId, documentId);
  const currentRetryCount = existingDoc?.retryCount ?? 0;
  const alreadyHasContent = Boolean(existingDoc?.htmlContentKey);

  console.log(`[worker] Current retry count for documentId=${documentId}: ${currentRetryCount}/${MAX_GENERATION_RETRIES}`);

  try {
    // Check if document already has content (from a previous attempt that succeeded generation
    // but failed S3 read during validation). If so, skip regeneration and just validate.

    if (alreadyHasContent) {
      console.log(`[worker] Document ${documentId} already has content (htmlContentKey: ${existingDoc?.htmlContentKey}), skipping regeneration`);
    } else {
      await processJobInner(job);
    }

    // After generation completes (or if skipped), validate the content quality
    const updatedDoc = alreadyHasContent ? existingDoc : await getRFPDocument(projectId, opportunityId, documentId);

    // Load HTML content from S3 if htmlContentKey exists
    // Retry S3 reads with exponential backoff to handle transient errors
    let htmlContent: string | null = null;
    if (updatedDoc?.htmlContentKey) {
      for (let s3Attempt = 1; s3Attempt <= MAX_S3_READ_RETRIES; s3Attempt++) {
        try {
          htmlContent = await loadRFPDocumentHtml(updatedDoc.htmlContentKey as string);
          break; // Success - exit retry loop
        } catch (err) {
          console.warn(`[worker] S3 read attempt ${s3Attempt}/${MAX_S3_READ_RETRIES} failed: ${(err as Error).message}`);
          if (s3Attempt < MAX_S3_READ_RETRIES) {
            const delayMs = S3_RETRY_BASE_DELAY_MS * Math.pow(2, s3Attempt - 1);
            console.log(`[worker] Retrying S3 read in ${delayMs}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          } else {
            // All S3 read attempts failed - can't validate content, must mark as failed
            console.error(`[worker] All S3 read attempts failed for documentId=${documentId}`);
            await markAsPermanentlyFailed(job, `Cannot validate content: S3 read failed after ${MAX_S3_READ_RETRIES} attempts`);
            return;
          }
        }
      }
    }

    // Validate content quality (only if we successfully read the content or have no content)
    const validation = validateGeneratedContent(htmlContent);

    if (!validation.isValid) {
      console.warn(`[worker] Content validation failed for documentId=${documentId}: ${validation.reason}`);

      // Allow retries until we've made MAX_GENERATION_RETRIES total attempts
      // e.g., with MAX=3: initial (0) + retry 1 (1) + retry 2 (2) = 3 total attempts
      if (currentRetryCount < MAX_GENERATION_RETRIES - 1) {
        // Retry: re-enqueue with exponential backoff delay
        await enqueueRetry(job, currentRetryCount);
        return; // Don't throw - we're retrying
      } else {
        // Max retries reached (have made 3 total attempts): mark as permanently failed and notify
        await markAsPermanentlyFailed(job, validation.reason ?? 'Unknown validation failure');
        return; // Don't throw - we've handled the failure
      }
    }

    console.log(`[worker] Content validation passed for documentId=${documentId}`);

    // Validation passed — now set status to READY
    await updateRFPDocumentMetadata({
      projectId,
      opportunityId,
      documentId,
      updates: {
        status: 'READY',
        retryCount: 0, // Reset retry count on success
        generationError: '', // Clear any previous error (empty string, not null - schema is string|undefined)
      },
      updatedBy: 'system',
    });
    console.log(`[worker] Document status set to READY for documentId=${documentId}`);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    console.error(`[FATAL] processJob failed for documentId=${documentId}:`, errorMessage, err);

    // Check if we should retry or mark as failed
    if (currentRetryCount < MAX_GENERATION_RETRIES - 1) {
      // Retry on error (content regeneration - clears content)
      console.log(`[worker] Retrying after error for documentId=${documentId}`);
      try {
        await enqueueRetry(job, currentRetryCount);
        return; // Don't throw - we're retrying
      } catch (retryErr) {
        console.error(`[worker] Failed to enqueue retry:`, (retryErr as Error)?.message);
      }
    }

    // Max retries reached or retry failed: mark as failed
    try {
      await markAsPermanentlyFailed(job, errorMessage.substring(0, 500));
      // Successfully marked as failed - return normally so SQS deletes the message.
      // If we throw here, SQS will re-deliver and we'd send duplicate notifications.
      return;
    } catch (statusErr) {
      console.error(`[FATAL] Failed to mark documentId=${documentId} as FAILED:`, (statusErr as Error)?.message);
      // Only throw if we couldn't record the failure state - this ensures SQS retries
      // so we have another chance to properly mark the document as failed
      throw err;
    }
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
