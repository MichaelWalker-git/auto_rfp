import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { DOCUMENT_PK } from '../constants/document';
import { KnowledgeBase, KnowledgeBaseItem } from '../schemas/knowledge-base';

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

// --- Main Handler ---

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId } = event.queryStringParameters || {};

    if (!orgId) {
      return apiResponse(400, {
        message: 'Missing required path parameter: orgId',
      });
    }

    const knowledgeBases = await listKnowledgeBasesForOrg(orgId);

    return apiResponse(200, knowledgeBases);
  } catch (err) {
    console.error('Error in getKnowledgeBases handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// --- List KBs for org ----

export async function listKnowledgeBasesForOrg(
  orgId: string,
): Promise<KnowledgeBase[]> {
  const items: KnowledgeBaseItem[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  const skPrefix = `${orgId}#`;

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
          ':pkValue': KNOWLEDGE_BASE_PK,
          ':skPrefix': skPrefix,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items && res.Items.length > 0) {
      items.push(...(res.Items as KnowledgeBaseItem[]));
    }

    ExclusiveStartKey = res.LastEvaluatedKey as
      | Record<string, any>
      | undefined;
  } while (ExclusiveStartKey);

  // For each KB, compute documents count (PK = DOCUMENT_PK, SK begins_with "KB#<kbId>")
  return await Promise.all(
    items.map(async (item) => {
      const sk = item[SK_NAME] as string;
      const kbId = sk.split('#')[1];

      const documentsCount = await getDocumentCountForKnowledgeBase(kbId);

      return {
        id: kbId,
        name: item.name,
        description: item.description,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        _count: {
          questions: item._count?.questions ?? 0,
          documents: documentsCount,
        },
      } as KnowledgeBase;
    }),
  );
}

// --- Helper: count documents for a KB ---
//
// Document items:
//   PK = DOCUMENT_PK
//   SK starts with `KB#${knowledgeBaseId}`
async function getDocumentCountForKnowledgeBase(
  knowledgeBaseId: string,
): Promise<number> {
  const skPrefix = `KB#${knowledgeBaseId}`;
  let count = 0;
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

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
          ':pkValue': DOCUMENT_PK,
          ':skPrefix': skPrefix,
        },
        Select: 'COUNT',
        ExclusiveStartKey,
      }),
    );

    count += res.Count ?? 0;
    ExclusiveStartKey = res.LastEvaluatedKey as
      | Record<string, any>
      | undefined;
  } while (ExclusiveStartKey);

  return count;
}
