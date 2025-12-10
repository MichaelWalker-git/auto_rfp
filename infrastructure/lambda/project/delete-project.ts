import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
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
    const projectId = event.pathParameters?.projectId || event.pathParameters?.id;
    const { orgId } = event.queryStringParameters || {};

    if (!orgId || !projectId) {
      return apiResponse(400, {
        message: 'Missing required query parameters: orgId and projectId',
      });
    }

    await deleteProject(orgId, projectId);

    return apiResponse(200, {
      success: true,
      message: 'Project deleted successfully',
      orgId,
      projectId,
    });
  } catch (err: any) {
    console.error('Error in deleteProject handler:', err);

    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Project not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// --- Business logic ---

export async function deleteProject(
  orgId: string,
  projectId: string,
): Promise<void> {
  const key = {
    [PK_NAME]: PROJECT_PK,
    [SK_NAME]: `${orgId}#${projectId}`, // same composite SK as in createProject
  };

  const cmd = new DeleteCommand({
    TableName: DB_TABLE_NAME,
    Key: key,
    // Only delete if item exists
    ConditionExpression:
      'attribute_exists(#pk) AND attribute_exists(#sk)',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
  });

  await docClient.send(cmd);
}

export const handler = withSentryLambda(baseHandler);