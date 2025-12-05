import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { SFNClient, StartExecutionCommand, } from '@aws-sdk/client-sfn';
import { apiResponse } from '../helpers/api';

const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  'us-east-1';

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

if (!STATE_MACHINE_ARN) {
  throw new Error('STATE_MACHINE_ARN environment variable is not set');
}

const sfnClient = new SFNClient({ region: REGION });

// Lambda is designed to be invoked via API Gateway HTTP API / REST API
// with JSON body: { "documentId": "..." }
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, {
        message: 'Request body is required',
      });
    }

    let parsedBody: any;
    try {
      parsedBody = JSON.parse(event.body);
    } catch {
      return apiResponse(400, {
        message: 'Invalid JSON in request body',
      });
    }

    const documentId = parsedBody.documentId as string | undefined;

    if (!documentId || typeof documentId !== 'string') {
      return apiResponse(400, {
        message: '`documentId` is required and must be a string',
      });
    }

    // Optional: you can pass additional metadata if needed (orgId, kbId, etc.)
    const input = JSON.stringify({
      documentId,
    });

    const startCommand = new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      input,
    });

    const resp = await sfnClient.send(startCommand);

    // Return 202 Accepted – indexing is async
    return apiResponse(202, {
      message: 'Indexing pipeline started',
      documentId,
      executionArn: resp.executionArn,
      startDate: resp.startDate?.toISOString?.() ?? resp.startDate,
    });
  } catch (err) {
    console.error('Error starting indexing state machine:', err);

    return apiResponse(500, {
      message: 'Failed to start indexing pipeline',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};
