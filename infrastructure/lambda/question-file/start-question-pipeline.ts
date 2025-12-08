import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { apiResponse } from '../helpers/api';

const sfnClient = new SFNClient({});
const STATE_MACHINE_ARN = process.env.QUESTION_PIPELINE_STATE_MACHINE_ARN;

if (!STATE_MACHINE_ARN) {
  throw new Error('QUESTION_PIPELINE_STATE_MACHINE_ARN env var is not set');
}

interface StartBody {
  questionFileId?: string;
  projectId?: string;
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('start-question-pipeline event:', JSON.stringify(event));

  if (!event.body) {
    return apiResponse(400, { message: 'Request body is required' });
  }

  let body: StartBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { message: 'Invalid JSON body' });
  }

  const { questionFileId, projectId } = body;

  if (!questionFileId || !projectId) {
    return apiResponse(400, {
      message: 'questionFileId and projectId are required',
    });
  }

  try {
    const res = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        input: JSON.stringify({
          questionFileId,
          projectId,
        }),
      }),
    );

    return apiResponse(202, {
      message: 'Question pipeline started',
      executionArn: res.executionArn,
      startDate: res.startDate,
    });
  } catch (err) {
    console.error('Error starting question pipeline:', err);
    return apiResponse(500, {
      message: 'Failed to start question pipeline',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};
