import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getExtractionJobRecord, updateExtractionJobProgress } from '@/helpers/extraction';
import { nowIso } from '@/helpers/date';
import { extractPastPerformanceFromDocument, extractLaborRatesFromDocument, extractBOMItemsFromDocument } from '@/helpers/extraction-processor';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import type { ExtractionTargetType } from '@auto-rfp/core';

interface ExtractionMessage {
  jobId: string;
  orgId: string;
}

/**
 * SQS worker that processes extraction jobs.
 * Uses batch item failures to only retry genuinely failed messages.
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log(`Processing ${event.Records.length} extraction job(s)`);

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const message: ExtractionMessage = JSON.parse(record.body);
      const { jobId, orgId } = message;

      console.log(`Starting extraction for job ${jobId} in org ${orgId}`);
      
      // Get the job record
      const job = await getExtractionJobRecord(orgId, jobId);
      if (!job) {
        console.error(`Job ${jobId} not found - skipping (will not retry)`);
        // Don't retry if job doesn't exist - it's a data issue, not transient
        continue;
      }

      // Check if job is already completed/failed - don't reprocess
      if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        console.log(`Job ${jobId} already in terminal state ${job.status} - skipping`);
        continue;
      }

      // Update status to processing
      await updateExtractionJobProgress(orgId, jobId, {
        status: 'PROCESSING',
        startedAt: nowIso(),
      });

      const draftsCreated: string[] = [];
      const errors: { source: string; error: string; timestamp: string }[] = [];
      let processedItems = 0;
      let successfulItems = 0;
      let failedItems = 0;

      // Process each source file based on targetType
      const targetType = job.targetType ?? 'PAST_PERFORMANCE';
      console.log(`Processing ${job.sourceFiles.length} files with targetType: ${targetType}`);
      
      for (const sourceFile of job.sourceFiles) {
        try {
          console.log(`Processing file: ${sourceFile.fileName}`);
          
          const extractionInput = {
            orgId,
            jobId,
            s3Key: sourceFile.s3Key,
            fileName: sourceFile.fileName,
            userId: job.createdBy,
          };
          
          let resultIds: string[];
          switch (targetType) {
            case 'LABOR_RATE':
              resultIds = await extractLaborRatesFromDocument(extractionInput);
              break;
            case 'BOM_ITEM':
              resultIds = await extractBOMItemsFromDocument(extractionInput);
              break;
            case 'PAST_PERFORMANCE':
            default:
              resultIds = await extractPastPerformanceFromDocument(extractionInput);
              break;
          }
          
          draftsCreated.push(...resultIds);
          successfulItems++;
        } catch (fileError) {
          const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
          console.error(`Failed to process file ${sourceFile.fileName}:`, errorMessage, fileError);
          errors.push({
            source: sourceFile.fileName,
            error: errorMessage,
            timestamp: nowIso(),
          });
          failedItems++;
        }
        processedItems++;
        
        // Update progress
        await updateExtractionJobProgress(orgId, jobId, {
          processedItems,
          successfulItems,
          failedItems,
          draftsCreated,
          errors,
        });
      }

      // Mark job as complete
      const finalStatus = failedItems === job.sourceFiles.length ? 'FAILED' : 'COMPLETED';
      const completedAt = nowIso();
      await updateExtractionJobProgress(orgId, jobId, {
        status: finalStatus,
        completedAt,
        draftsCreated,
      });

      console.log(`Completed extraction for job ${jobId}: ${successfulItems} successful, ${failedItems} failed`);

      // Non-blocking audit log for job completion/failure
      getHmacSecret().then(hmacSecret => {
        writeAuditLog(
          {
            logId: uuidv4(),
            timestamp: completedAt,
            userId: 'system',
            userName: 'system',
            organizationId: orgId,
            action: finalStatus === 'COMPLETED' ? 'EXTRACTION_JOB_COMPLETED' : 'EXTRACTION_JOB_FAILED',
            resource: 'extraction_job',
            resourceId: jobId,
            changes: {
              after: {
                status: finalStatus,
                targetType,
                successfulItems,
                failedItems,
                draftsCreatedCount: draftsCreated.length,
              },
            },
            ipAddress: '0.0.0.0',
            userAgent: 'system',
            result: finalStatus === 'COMPLETED' ? 'success' : 'failure',
          },
          hmacSecret,
        ).catch(err => console.warn('Failed to write audit log:', err.message));
      }).catch(err => console.warn('Failed to get HMAC secret for audit:', err.message));

      // Message processed successfully - don't add to failures
    } catch (error) {
      console.error('Error processing extraction message:', error);
      // Add to batch item failures so SQS will retry this message
      batchItemFailures.push({
        itemIdentifier: record.messageId,
      });
    }
  }

  // Return batch response - only failed items will be retried
  return {
    batchItemFailures,
  };
};
