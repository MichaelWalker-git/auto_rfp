import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { z } from 'zod';
import { withSentryLambda } from '../../sentry-lambda';
import { syncToGoogleDrive } from '@/helpers/google-drive';
import { getExecutiveBrief } from '@/helpers/executive-opportunity-brief';

const GoogleDriveSyncJobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  executiveBriefId: z.string().min(1),
  linearTicketId: z.string().optional(),
  linearTicketIdentifier: z.string().optional(),
  agencyName: z.string().optional(),
  projectTitle: z.string().optional(),
});

type GoogleDriveSyncJob = z.infer<typeof GoogleDriveSyncJobSchema>;

async function processJob(job: GoogleDriveSyncJob): Promise<void> {
  console.log(`Processing Google Drive sync for brief ${job.executiveBriefId}`);

  // Fetch the full brief data for upload
  const briefData = await getExecutiveBrief(job.executiveBriefId);

  const result = await syncToGoogleDrive({
    orgId: job.orgId,
    projectId: job.projectId,
    opportunityId: job.opportunityId,
    executiveBriefId: job.executiveBriefId,
    linearTicketId: job.linearTicketId,
    linearTicketIdentifier: job.linearTicketIdentifier,
    agencyName: job.agencyName,
    projectTitle: job.projectTitle,
    briefData,
  });

  console.log(
    `Google Drive sync complete for brief ${job.executiveBriefId}: ` +
    `${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors.length} errors`,
  );

  if (result.folderUrl) {
    console.log(`Google Drive folder: ${result.folderUrl}`);
  }

  if (result.errors.length > 0) {
    console.warn(`Google Drive sync errors (${result.errors.length}):`);
    result.errors.forEach((err, i) => console.warn(`  Error ${i + 1}: ${err}`));
  }
}

const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      const rawBody = JSON.parse(record.body);
      const job = GoogleDriveSyncJobSchema.parse(rawBody);
      await processJob(job);
    } catch (err) {
      console.error(
        `Failed to process Google Drive sync message ${record.messageId}:`,
        (err as Error)?.message,
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
