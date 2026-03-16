import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { requireEnv } from './env';

const sqs = new SQSClient({});
const DOCUMENT_GENERATION_QUEUE_URL = requireEnv('DOCUMENT_GENERATION_QUEUE_URL');

export interface DocumentGenerationMessage {
  orgId: string;
  projectId: string;
  /** Required — used by tools to fetch deadlines and brief analysis */
  opportunityId: string;
  documentType: string;
  templateId?: string;
  documentId: string;
  /** Optional export options for CLARIFYING_QUESTIONS document type */
  options?: Record<string, unknown>;
}

/**
 * Enqueue a document generation job to be processed asynchronously via SQS.
 * The caller creates a placeholder DB record first, then enqueues this message.
 * The worker will run Bedrock and update the DB record with the generated content.
 */
export const enqueueDocumentGeneration = async (
  message: DocumentGenerationMessage,
): Promise<void> => {
  console.log(`Enqueuing document generation for documentId ${message.documentId}`);

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: DOCUMENT_GENERATION_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    }),
  );

  console.log(`Document generation enqueued for documentId ${message.documentId}`);
};
