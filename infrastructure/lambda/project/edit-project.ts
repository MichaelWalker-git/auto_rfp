import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { UpdateCommand, } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { UpdateProjectDTO, UpdateProjectSchema } from '@auto-rfp/shared';
import { docClient } from '../helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, projectId } = event.queryStringParameters || {};

    if (!orgId || !projectId) {
      return apiResponse(400, {
        message: 'Missing required query parameters: orgId and projectId',
      });
    }

    if (!event.body) {
      return apiResponse(400, { message: 'Request body is missing' });
    }

    const rawBody = JSON.parse(event.body);

    // 1. Validate body (partial)
    const validationResult = UpdateProjectSchema.safeParse(rawBody);

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

    const dto: UpdateProjectDTO = validationResult.data;

    // If nothing to update (empty body), you can either no-op or return 400
    if (!dto.name && dto.description === undefined) {
      return apiResponse(400, {
        message: 'No updatable fields provided',
      });
    }

    const updated = await updateProject(orgId, projectId, dto);

    return apiResponse(200, updated);
  } catch (err: any) {
    console.error('Error in updateProject handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

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

export async function updateProject(
  orgId: string,
  projectId: string,
  dto: UpdateProjectDTO,
) {
  const now = new Date().toISOString();

  const key = {
    [PK_NAME]: PROJECT_PK,
    [SK_NAME]: `${orgId}#${projectId}`, // same pattern as createProject
  };

  // Dynamic UpdateExpression
  const expressionAttributeNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':updatedAt': now,
  };
  const setExpressions: string[] = ['#updatedAt = :updatedAt'];

  if (dto.name !== undefined) {
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = dto.name;
    setExpressions.push('#name = :name');
  }

  if (dto.description !== undefined) {
    expressionAttributeNames['#description'] = 'description';
    expressionAttributeValues[':description'] = dto.description;
    setExpressions.push('#description = :description');
  }

  const cmd = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: key,
    UpdateExpression: 'SET ' + setExpressions.join(', '),
    ExpressionAttributeNames: {
      ...expressionAttributeNames,
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
    ExpressionAttributeValues: expressionAttributeValues,
    ConditionExpression:
      'attribute_exists(#pk) AND attribute_exists(#sk)', // ensure project exists
    ReturnValues: 'ALL_NEW',
  });

  const res = await docClient.send(cmd);

  return res.Attributes;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(httpErrorMiddleware())
);