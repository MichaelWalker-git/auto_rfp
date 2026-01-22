import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { PutCommand, } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { CreateProjectDTO, CreateProjectSchema, ProjectItem } from '@auto-rfp/shared';

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
import { docClient } from '../helpers/db';
import { DBProjectItem } from '../types/project';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    const validationResult = CreateProjectSchema.safeParse(rawBody);

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

    const dto: CreateProjectDTO = validationResult.data;

    const project = await createProject(dto);

    return apiResponse(201, project);
  } catch (err) {
    console.error('Error in createProject handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export async function createProject(dto: CreateProjectDTO): Promise<ProjectItem> {
  const { orgId, name, description } = dto;

  const now = new Date().toISOString();
  const projectId = uuidv4();

  const sortKey = `${orgId}#${projectId}`;

  const projectItem: DBProjectItem = {
    [PK_NAME]: PROJECT_PK,
    [SK_NAME]: sortKey,
    id: projectId,
    orgId,
    name,
    description,
    createdAt: now,
    updatedAt: now,
  };

  const cmd = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: projectItem,
    ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
  });

  await docClient.send(cmd);

  return projectItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:create'))
    .use(httpErrorMiddleware())
);