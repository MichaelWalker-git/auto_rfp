import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { requireEnv } from './env';

const sqs = new SQSClient({});

export interface PackageEditJob {
  orgId: string;
  projectId: string;
  oppId: string;
  runId: string;
}

/** Enqueue a package-edit proposal scan to be processed asynchronously by the worker. */
export const enqueuePackageEditProposal = async (job: PackageEditJob): Promise<void> => {
  const queueUrl = requireEnv('PACKAGE_EDIT_QUEUE_URL');
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(job),
    }),
  );
};
