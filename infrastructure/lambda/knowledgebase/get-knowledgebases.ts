import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse, getOrgId } from '../helpers/api';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { DOCUMENT_PK } from '../constants/document';
import { KnowledgeBase, KnowledgeBaseItem } from '@auto-rfp/shared';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { DBItem, docClient } from '../helpers/db';
import { safeSplitAt } from '../helpers/safe-string';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const tokenOrgId = getOrgId(event);
    const { orgId: queryOrgId } = event.queryStringParameters || {};
    const orgId = tokenOrgId ? tokenOrgId : queryOrgId;
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

export async function listKnowledgeBasesForOrg(orgId: string): Promise<KnowledgeBase[]> {
  const items: (KnowledgeBaseItem & DBItem)[] = [];
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
      items.push(...(res.Items as (KnowledgeBaseItem & DBItem)[]));
    }

    ExclusiveStartKey = res.LastEvaluatedKey as
      | Record<string, any>
      | undefined;
  } while (ExclusiveStartKey);

  // For each KB, compute documents count (PK = DOCUMENT_PK, SK begins_with "KB#<kbId>")
  return await Promise.all(
    items.map(async (item) => {
      const sk = item[SK_NAME] as string;
      const kbId = safeSplitAt(sk, '#', 1);

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

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:read'))
    .use(httpErrorMiddleware())
);