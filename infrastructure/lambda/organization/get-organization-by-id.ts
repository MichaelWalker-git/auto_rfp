import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { GetCommand, } from '@aws-sdk/lib-dynamodb';
import { ORG_PK } from '../constants/organization';
import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import type { OrganizationItem } from '../schemas/organization';
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
import { safeSplitAt } from '../helpers/safe-string';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.id;

    if (!orgId) {
      return apiResponse(400, { message: 'Missing required path parameter: id' });
    }

    const orgItem = await getOrganizationById(orgId);

    if (!orgItem) {
      return apiResponse(404, { message: 'Organization not found' });
    }

    const enriched = enrichUsersCount(orgItem);

    return apiResponse(200, enriched);
  } catch (err) {
    console.error('Error in getOrganizationById handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export async function getOrganizationById(
  orgId: string,
): Promise<OrganizationItem | undefined> {
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: ORG_PK,
        [SK_NAME]: `ORG#${orgId}`,
      },
    }),
  );

  return res.Item as OrganizationItem | undefined;
}

const enrichUsersCount = (org: OrganizationItem & { sort_key: string }) => {
  const count = {
    organizationUsers: 0,
    projects: 0,
  };

  return {
    ...org,
    _count: count,
    id: orgSortKeyToId(org.sort_key),
  };
};

const orgSortKeyToId = (sortKey: string) => {
  return safeSplitAt(sortKey, '#', 1);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:read'))
    .use(httpErrorMiddleware())
);