import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { KNOWLEDGE_BASE_PK } from '@/constants/organization';
import { DOCUMENT_PK } from '@/constants/document';
import { apiResponse, getOrgId } from '@/helpers/api';
import { KnowledgeBaseItem, UpdateKnowledgeBaseDTO, UpdateKnowledgeBaseSchema, } from '@auto-rfp/core';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import middy from '@middy/core';
import { docClient } from '@/helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const tokenOrgId = getOrgId(event);
  const { orgId: queryOrgId, kbId } = event.queryStringParameters || {};
  const orgId = tokenOrgId ? tokenOrgId : queryOrgId;
  if (!orgId || !kbId) {
    return apiResponse(400, {
      message: 'Missing required path parameters: orgId and kbId',
    });
  }

  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Validate body with Zod
    const validationResult = UpdateKnowledgeBaseSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues.map((issue: any) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const validatedData: UpdateKnowledgeBaseDTO = validationResult.data;

    const updatedKb = await updateKnowledgeBase(orgId, kbId, validatedData);

    return apiResponse(200, updatedKb);
  } catch (err) {
    console.error('Error in updateKnowledgeBase handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// --- Business Logic Function ---
export async function updateKnowledgeBase(
  orgId: string,
  kbId: string,
  data: UpdateKnowledgeBaseDTO,
) {
  const now = new Date().toISOString();
  const sk = `${orgId}#${kbId}`;

  // Build dynamic UpdateExpression
  let updateExpression = 'SET #updatedAt = :updatedAt';
  const expressionAttributeNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
    '#pk': PK_NAME,
  };
  const expressionAttributeValues: Record<string, any> = {
    ':updatedAt': now,
  };

  if (typeof data.name === 'string') {
    updateExpression += ', #name = :name';
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = data.name;
  }

  if (data.description !== undefined) {
    updateExpression += ', #description = :description';
    expressionAttributeNames['#description'] = 'description';
    expressionAttributeValues[':description'] = data.description;
  }

  const command = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: KNOWLEDGE_BASE_PK,
      [SK_NAME]: sk,
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ConditionExpression: 'attribute_exists(#pk)', // 404 if not found
    ReturnValues: 'ALL_NEW',
  });

  try {
    const result = await docClient.send(command);

    if (!result.Attributes) {
      throw new Error('Update succeeded but no attributes returned');
    }

    const item = result.Attributes as KnowledgeBaseItem;

    // Get document count for this knowledge base
    const documentsCount = await getDocumentCountForKnowledgeBase(kbId);

    // Map DB item -> API shape
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
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      // Not found
      throw new Error('Knowledge base not found');
    }

    throw err;
  }
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
    .use(requirePermission('kb:edit'))
    .use(httpErrorMiddleware())
);
