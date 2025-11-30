import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand, // ⬅️ use ScanCommand instead of QueryCommand
} from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';

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

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { id: projectId } = event.pathParameters || {};

    if (!projectId) {
      return apiResponse(400, {
        message: 'Missing required query parameter: projectId',
      });
    }

    const project = await getProjectById(projectId);

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

export async function getProjectById(projectId: string): Promise<any | null> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  // Suffix used in SK: "<orgId>#<projectId>"
  const idSuffix = `#${projectId}`;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: DB_TABLE_NAME,
        FilterExpression: '#pk = :pkValue AND contains(#sk, :idSuffix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pkValue': PROJECT_PK,
          ':idSuffix': idSuffix,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items && res.Items.length > 0) {
      items.push(...res.Items);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (ExclusiveStartKey);

  if (items.length === 0) {
    return null;
  }

  // From filtered results, pick the one whose SK really ends with "#<projectId>"
  const exact = items.find((item) => {
    const sk = item[SK_NAME];
    return typeof sk === 'string' && sk.endsWith(idSuffix);
  });

  return exact ?? null;
}
