import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { withSentryLambda } from '../sentry-lambda';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME env var is not set');
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId } = event.queryStringParameters || {};

    if (!projectId) {
      return apiResponse(400, { message: 'projectId is required' });
    }

    const items: any[] = [];
    let lastKey: Record<string, any> | undefined;

    do {
      const res = await docClient.send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          KeyConditionExpression:
            '#pk = :pk AND begins_with(#sk, :skPrefix)',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
            '#sk': SK_NAME,
          },
          ExpressionAttributeValues: {
            ':pk': QUESTION_FILE_PK,
            ':skPrefix': `${projectId}#`,
          },
          ExclusiveStartKey: lastKey,
          ScanIndexForward: true,
        }),
      );

      if (res.Items?.length) items.push(...res.Items);
      lastKey = res.LastEvaluatedKey as any;
    } while (lastKey);


    return apiResponse(200, { items });
  } catch (err) {
    console.error('get-question-files error:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
