import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { withSentryLambda } from '../sentry-lambda';

const sfnClient = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

if (!STATE_MACHINE_ARN) {
  throw new Error('STATE_MACHINE_ARN environment variable is not set');
}

interface StartPipelineRequestBody {
  documentId?: string;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('start-document-pipeline event:', JSON.stringify(event));

  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Request body is required' }),
    };
  }

  let body: StartPipelineRequestBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Invalid JSON body' }),
    };
  }

  const { documentId } = body;
  if (!documentId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'documentId is required' }),
    };
  }

  // Optional: you can add tenant/org validation here based on auth claims

  // Step Functions input – must match what StartTextractJobLambda expects
  const input = {
    documentId,
  };

  try {
    const startRes = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        input: JSON.stringify(input),
      }),
    );

    return {
      statusCode: 202,
      body: JSON.stringify({
        message: 'Document pipeline started',
        executionArn: startRes.executionArn,
        startDate: startRes.startDate,
      }),
    };
  } catch (err) {
    console.error('Error starting state machine:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to start document pipeline',
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
    };
  }
};

export const handler = withSentryLambda(baseHandler);
