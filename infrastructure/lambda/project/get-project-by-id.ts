import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, } from '@aws-sdk/lib-dynamodb';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getProjectById } from '../helpers/project';

const ddbClient = new DynamoDBClient({});
const docClient: DynamoDBDocumentClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { id: projectId } = event.pathParameters || {};

    if (!projectId) {
      return apiResponse(400, {
        message: 'Missing required query parameter: projectId',
      });
    }

    const project = await getProjectById(docClient, DB_TABLE_NAME, projectId);

    if (!project) {
      return apiResponse(404, { message: 'Project not found' });
    }

    return apiResponse(200, project);
  } catch (err) {
    console.error('Error in getProjectById handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};


export const handler = withSentryLambda(baseHandler);
