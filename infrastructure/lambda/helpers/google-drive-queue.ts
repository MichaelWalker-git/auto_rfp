import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { requireEnv } from './env';

const sqs = new SQSClient({});
const GOOGLE_DRIVE_SYNC_QUEUE_URL = requireEnv('GOOGLE_DRIVE_SYNC_QUEUE_URL');

export interface GoogleDriveSyncMessage {
  orgId: string;
  projectId: string;
  opportunityId: string;
  executiveBriefId: string;
  linearTicketId?: string;
  linearTicketIdentifier?: string;
  agencyName?: string;
  projectTitle?: string;
}

/**
 * Enqueue a Google Drive sync job to be processed asynchronously.
 * This avoids blocking the caller (e.g. update-decision, exec-brief-worker)
 * while the potentially slow Google Drive operations run.
 */
export async function enqueueGoogleDriveSync(
  message: GoogleDriveSyncMessage,
): Promise<void> {
  console.log(`Enqueuing Google Drive sync for brief ${message.executiveBriefId}`);

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: GOOGLE_DRIVE_SYNC_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    }),
  );

  console.log(`Google Drive sync enqueued for brief ${message.executiveBriefId}`);
}
