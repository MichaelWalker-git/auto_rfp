import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { requireEnv } from './env';

const sfn = new SFNClient({});

const getExtractionStateMachineArn = () => requireEnv('EXTRACTION_PIPELINE_STATE_MACHINE_ARN');

export interface StartExtractionPipelineInput {
  jobId: string;
  orgId: string;
  targetType: 'PAST_PERFORMANCE' | 'LABOR_RATE' | 'BOM_ITEM';
  sourceFiles: Array<{
    fileId: string;
    fileName: string;
    fileKey: string;
    mimeType?: string;
  }>;
  userId: string;
}

export const startExtractionPipeline = async (input: StartExtractionPipelineInput) => {
  const res = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: getExtractionStateMachineArn(),
      name: `extraction-${input.jobId}`,
      input: JSON.stringify(input),
    }),
  );

  return { executionArn: res.executionArn, startDate: res.startDate };
};
