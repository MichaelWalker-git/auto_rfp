import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { requireEnv } from './env';

const sqs = new SQSClient({});
const CLARIFYING_QUESTION_QUEUE_URL = requireEnv('CLARIFYING_QUESTION_QUEUE_URL', '');

export interface ClarifyingQuestionGenerationMessage {
  orgId: string;
  projectId: string;
  opportunityId: string;
  /** How many questions to generate (1-20) */
  topK: number;
  /** If true, regenerate even if questions already exist */
  force: boolean;
  /** User ID for audit trail */
  userId: string;
  /** User name for audit trail */
  userName: string;
}

/**
 * Enqueue a clarifying question generation job to be processed asynchronously via SQS.
 * The worker will:
 * 1. Load solicitation documents
 * 2. Get executive brief context
 * 3. Query KB for additional context
 * 4. Invoke Claude to generate questions
 * 5. Save questions to DynamoDB
 */
export const enqueueClarifyingQuestionGeneration = async (
  message: ClarifyingQuestionGenerationMessage,
): Promise<void> => {
  if (!CLARIFYING_QUESTION_QUEUE_URL) {
    throw new Error('CLARIFYING_QUESTION_QUEUE_URL environment variable not configured');
  }

  console.log(`Enqueuing clarifying question generation for opportunityId=${message.opportunityId}`);

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: CLARIFYING_QUESTION_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    }),
  );

  console.log(`Clarifying question generation enqueued for opportunityId=${message.opportunityId}`);
};
