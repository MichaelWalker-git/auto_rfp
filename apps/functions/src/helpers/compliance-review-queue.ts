import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { requireEnv } from './env';

const sqs = new SQSClient({});

export interface ComplianceReviewJob {
  orgId: string;
  projectId: string;
  oppId: string;
  reviewId: string;
}

/** Enqueue a full-package review to be processed asynchronously by the worker. */
export const enqueueComplianceReview = async (job: ComplianceReviewJob): Promise<void> => {
  const queueUrl = requireEnv('COMPLIANCE_REVIEW_QUEUE_URL');
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(job),
    }),
  );
};
