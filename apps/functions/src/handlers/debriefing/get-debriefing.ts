import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { DEBRIEFING_PK } from '@/constants/organization';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import type { DBDebriefingItem } from '@/types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, projectId, opportunityId } = event.queryStringParameters || {};

    if (!orgId || !projectId || !opportunityId) {
      return apiResponse(400, {
        message: 'Missing required query parameters: orgId, projectId, and opportunityId',
      });
    }

    const debriefings = await getDebriefingsForProject(orgId, projectId, opportunityId);

    return apiResponse(200, { debriefings });
  } catch (err: unknown) {
    console.error('Error in getDebriefing handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const getDebriefingsForProject = async (
  orgId: string,
  projectId: string,
  opportunityId: string
): Promise<DBDebriefingItem[]> => {
  const sortKeyPrefix = `${orgId}#${projectId}#${opportunityId}#`;

  const cmd = new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: `${PK_NAME} = :pk AND begins_with(${SK_NAME}, :skPrefix)`,
    ExpressionAttributeValues: {
      ':pk': DEBRIEFING_PK,
      ':skPrefix': sortKeyPrefix,
    },
    ScanIndexForward: false, // Most recent first
  });

  const result = await docClient.send(cmd);

  return (result.Items || []) as DBDebriefingItem[];
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware())
);
