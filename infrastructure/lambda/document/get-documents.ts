import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { withSentryLambda } from '../sentry-lambda';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const kbId =
      event.queryStringParameters?.kbId ||
      event.pathParameters?.kbId;

    if (!kbId) {
      return apiResponse(400, {
        message: 'Missing required query parameter: kbId',
      });
    }

    const documents = await listDocuments(kbId);

    return apiResponse(200, documents);
  } catch (err) {
    console.error('Error in get-documents handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// ----------------------------------------------------
// Core: Query all documents for a KnowledgeBase
// ----------------------------------------------------
export async function listDocuments(
  knowledgeBaseId: string
): Promise<any[]> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  // SK pattern: "KB#<kbId>#DOC#<id>"
  const skPrefix = `KB#${knowledgeBaseId}#DOC#`;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression:
          '#pk = :pkValue AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pkValue': 'DOCUMENT',
          ':skPrefix': skPrefix,
        },
        ExclusiveStartKey,
      })
    );

    if (res.Items && res.Items.length > 0) {
      items.push(...res.Items);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as
      | Record<string, any>
      | undefined;
  } while (ExclusiveStartKey);

  // Extract documentId from SK
  return items.map((item) => {
    const sk = item[SK_NAME] as string;
    // Format: KB#<kbId>#DOC#<documentId>
    const parts = sk.split('#');
    const documentId = parts[3];

    return {
      ...item,
      id: documentId,
    };
  });
}

export const handler = withSentryLambda(baseHandler);