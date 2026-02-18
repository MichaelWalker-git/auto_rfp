import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { FOIA_REQUEST_PK } from '@/constants/organization';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import type { DBFOIARequestItem } from '@/types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, projectId } = event.queryStringParameters || {};

    if (!orgId || !projectId) {
      return apiResponse(400, {
        message: 'Missing required query parameters: orgId and projectId',
      });
    }

    const foiaRequests = await getFOIARequestsForProject(orgId, projectId);

    return apiResponse(200, { foiaRequests });
  } catch (err: unknown) {
    console.error('Error in getFOIARequests handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export async function getFOIARequestsForProject(
  orgId: string,
  projectId: string
): Promise<DBFOIARequestItem[]> {
  // Query all FOIA requests for this org/project
  const sortKeyPrefix = `${orgId}#${projectId}#`;

  const cmd = new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: `${PK_NAME} = :pk AND begins_with(${SK_NAME}, :skPrefix)`,
    ExpressionAttributeValues: {
      ':pk': FOIA_REQUEST_PK,
      ':skPrefix': sortKeyPrefix,
    },
    ScanIndexForward: false, // Most recent first
  });

  const result = await docClient.send(cmd);

  return (result.Items || []) as DBFOIARequestItem[];
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware())
);
