import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';
import { KnowledgeBase, KnowledgeBaseItem, } from '../schemas/knowledge-base';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error("DB_TABLE_NAME environment variable is not set");
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, kbId } = event.queryStringParameters || {};

    if (!orgId || !kbId) {
      return apiResponse(400, {
        message: "Missing required query params: orgId, kbId",
      });
    }

    const knowledgeBase = await getKnowledgeBase(orgId, kbId);

    if (!knowledgeBase) {
      return apiResponse(404, {
        message: "Knowledge Base not found",
      });
    }

    return apiResponse(200, knowledgeBase);
  } catch (err) {
    console.error("Error in getKnowledgeBase handler:", err);

    return apiResponse(500, {
      message: "Internal server error",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
};

export async function getKnowledgeBase(
  orgId: string,
  kbId: string
): Promise<KnowledgeBase | null> {
  const sk = `${orgId}#${kbId}`;

  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: KNOWLEDGE_BASE_PK,
        [SK_NAME]: sk,
      },
    })
  );

  if (!res.Item) return null;

  const item = res.Item as KnowledgeBaseItem;

  return {
    id: kbId,
    name: item.name,
    description: item.description,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    _count: {
      questions: item._count?.questions ?? 0,
    },
  };
}
