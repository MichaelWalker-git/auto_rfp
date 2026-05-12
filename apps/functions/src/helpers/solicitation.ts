import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { requireEnv } from './env';

const sfn = new SFNClient({});

/**
 * Get the Question Pipeline State Machine ARN.
 * - First, try the explicit env var (for Lambdas that have it set)
 * - Otherwise, construct it at runtime using REGION + STAGE + AWS_ACCOUNT_ID
 *   Pattern: arn:aws:states:{region}:{account}:stateMachine:AutoRfp-{stage}-Question-Pipeline
 */
const getStateMachineArn = (): string => {
  // Prefer explicit env var if set
  const envArn = process.env.QUESTION_PIPELINE_STATE_MACHINE_ARN;
  if (envArn && envArn.trim() !== '') {
    return envArn;
  }

  // Construct ARN at runtime using env vars (set by CDK)
  const region = requireEnv('REGION');
  const stage = requireEnv('STAGE');
  const accountId = requireEnv('AWS_ACCOUNT_ID');
  
    // Pattern: AutoRfp-${stage}-Question-Pipeline
  return `arn:aws:states:${region}:${accountId}:stateMachine:AutoRfp-${stage}-Question-Pipeline`;
};

export const startPipeline = async (
  orgId: string | undefined,
  projectId: string,
  oppId: string,
  questionFileId: string,
  sourceFileKey?: string,
  mimeType?: string,
) => {
  const res = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: getStateMachineArn(),
      input: JSON.stringify({
        orgId: orgId ?? '',
        oppId,
        projectId,
        questionFileId,
        sourceFileKey,
        mimeType,
      }),
    }),
  );

  return { executionArn: res.executionArn, startDate: res.startDate };
};
