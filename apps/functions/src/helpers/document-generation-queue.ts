import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { requireEnv } from './env';

const sqs = new SQSClient({});
const DOCUMENT_GENERATION_QUEUE_URL = requireEnv('DOCUMENT_GENERATION_QUEUE_URL');

export interface OrgContactInfo {
  orgName?: string;
  orgAddress?: string;
  orgPhone?: string;
  orgEmail?: string;
  orgWebsite?: string;
}

export interface UserContactInfo {
  name?: string;
  email?: string;
  title?: string;
  phone?: string;
}

export interface DocumentGenerationMessage {
  orgId: string;
  projectId: string;
  opportunityId?: string;
  documentType: string;
  templateId?: string;
  documentId: string;
  /** Organization contact info for use in cover letters and proposals */
  orgContact?: OrgContactInfo;
  /** Submitting user contact info for use in cover letters and proposals */
  userContact?: UserContactInfo;
}

/**
 * Enqueue a document generation job to be processed asynchronously via SQS.
 * The caller creates a placeholder DB record first, then enqueues this message.
 * The worker will run Bedrock and update the DB record with the generated content.
 */
export async function enqueueDocumentGeneration(
  message: DocumentGenerationMessage,
): Promise<void> {
  console.log(`Enqueuing document generation for documentId ${message.documentId}`);

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: DOCUMENT_GENERATION_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    }),
  );

  console.log(`Document generation enqueued for documentId ${message.documentId}`);
}
