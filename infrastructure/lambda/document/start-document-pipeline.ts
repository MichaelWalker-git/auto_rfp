import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { withSentryLambda } from '../sentry-lambda';
import { apiResponse } from '../helpers/api';

const sfnClient = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

if (!STATE_MACHINE_ARN) {
  throw new Error('STATE_MACHINE_ARN environment variable is not set');
}

interface StartPipelineRequestBody {
  knowledgeBaseId: string;
  documentId?: string;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('start-document-pipeline event:', JSON.stringify(event));

  if (!event.body) {
    return apiResponse(400, { message: 'Request body is required' });
  }

  let body: StartPipelineRequestBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { message: 'Invalid JSON body' });
  }

  const { documentId, knowledgeBaseId } = body;
  if (!documentId || !knowledgeBaseId) {
    return apiResponse(400, { message: 'documentId and knowledgeBaseId are required' });
  }

  const input = {
    documentId,
    knowledgeBaseId
  };

  try {
    const startRes = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        input: JSON.stringify(input),
      }),
    );

    return apiResponse(202, {
      message: 'Document pipeline started',
      executionArn: startRes.executionArn,
      startDate: startRes.startDate,
    });
  } catch (err) {
    console.error('Error starting state machine:', err);
    return apiResponse(500, {
      message: 'Failed to start document pipeline',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
