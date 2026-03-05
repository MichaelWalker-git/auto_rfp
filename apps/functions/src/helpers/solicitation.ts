import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { requireEnv } from './env';

const sfn = new SFNClient({});

// Resolved lazily — not all Lambdas that import this file have this env var
const getStateMachineArn = () => requireEnv('QUESTION_PIPELINE_STATE_MACHINE_ARN');

export async function startPipeline(
  projectId: string,
  oppId: string,
  questionFileId: string,
  sourceFileKey?: string,
  mimeType?: string,
) {
  const res = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: getStateMachineArn(),
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