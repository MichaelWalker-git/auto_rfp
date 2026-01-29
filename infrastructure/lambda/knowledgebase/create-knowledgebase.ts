import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { PutCommand, } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { apiResponse, getOrgId } from '../helpers/api';
import { CreateKnowledgeBaseDTO, CreateKnowledgeBaseSchema, KnowledgeBase, KnowledgeBaseItem, } from '@auto-rfp/shared';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const tokenOrgId = getOrgId(event);
  const { orgId: queryOrgId } = event.queryStringParameters || {};

  const orgId = tokenOrgId ? tokenOrgId : queryOrgId;

  if (!orgId) throw new Error('No orgId provided');

  try {
    const rawBody = JSON.parse(event.body || '');

    // 1. Runtime validation using Zod
    const validationResult = CreateKnowledgeBaseSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const validatedKbData: CreateKnowledgeBaseDTO = validationResult.data;

    const newKb = await createKnowledgeBase(orgId, validatedKbData);

    return apiResponse(201, newKb);
  } catch (err) {
    console.error('Error in createKnowledgeBase handler:', err);

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
export async function createKnowledgeBase(
  orgId: string,
  kbData: CreateKnowledgeBaseDTO,
): Promise<KnowledgeBase> {
  const now = new Date().toISOString();
  const kbId = uuidv4();

  const knowledgeBaseItem: KnowledgeBaseItem = {
    [PK_NAME]: KNOWLEDGE_BASE_PK,
    [SK_NAME]: `${orgId}#${kbId}`,
    id: kbId,
    orgId,
    name: kbData.name,
    description: kbData.description ?? undefined,
    createdAt: now,
    updatedAt: now,
    _count: {
      questions: 0,
      documents: 0,
    },
  } as KnowledgeBaseItem;

  const command = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: knowledgeBaseItem,
  });

  await docClient.send(command);

  return {
    id: kbId,
    name: knowledgeBaseItem.name,
    description: knowledgeBaseItem.description,
    createdAt: knowledgeBaseItem.createdAt,
    updatedAt: knowledgeBaseItem.updatedAt,
    _count: knowledgeBaseItem._count,
  };
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:create'))
    .use(httpErrorMiddleware())
);
