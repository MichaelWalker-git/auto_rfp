import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { DOCUMENT_PK } from '../constants/document';
import { apiResponse, getOrgId } from '../helpers/api';
import { KnowledgeBase, KnowledgeBaseItem, } from '@auto-rfp/shared';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const tokenOrgId = getOrgId(event);
    const { orgId: queryOrgId, kbId } = event.queryStringParameters || {};
    const orgId = tokenOrgId ? tokenOrgId : queryOrgId;

    if (!orgId || !kbId) {
      return apiResponse(400, {
        message: 'Missing required query params: orgId, kbId',
      });
    }

    const knowledgeBase = await getKnowledgeBase(orgId, kbId);

    if (!knowledgeBase) {
      return apiResponse(404, {
        message: 'Knowledge Base not found',
      });
    }

    return apiResponse(200, knowledgeBase);
  } catch (err) {
    console.error('Error in getKnowledgeBase handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
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

  // Get document count for this knowledge base
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
  };
}

// Helper: count documents for a KB
async function getDocumentCountForKnowledgeBase(
  knowledgeBaseId: string,
): Promise<number> {
  const skPrefix = `KB#${knowledgeBaseId}`;
  let count = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined = undefined;

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
      | Record<string, unknown>
      | undefined;
  } while (ExclusiveStartKey);

  return count;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:read'))
    .use(httpErrorMiddleware())
);
