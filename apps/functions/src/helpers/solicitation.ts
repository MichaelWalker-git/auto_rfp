import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { requireEnv } from './env';

const sfn = new SFNClient({});

const STATE_MACHINE_ARN = requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');

export async function startPipeline(
  projectId: string,
  oppId: string,
  questionFileId: string,
  sourceFileKey?: string,
  mimeType?: string,
) {
  const res = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify({
        oppId,
        projectId,
        questionFileId,
        sourceFileKey,
        mimeType,
      }),
    }),
  );

  return { executionArn: res.executionArn, startDate: res.startDate };
}