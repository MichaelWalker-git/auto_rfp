import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ORG_PK, PROJECT_PK } from '@/constants/organization';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { apiResponse, getUserId } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import { USER_PK } from '@/constants/user';
import { getAccessibleOrgIds } from '@/helpers/organization';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import middy from '@middy/core';
import { docClient } from '@/helpers/db';
import { safeSplitAt } from '@/helpers/safe-string';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const userId = getUserId(event);
    const list = await listOrganizations();

    let filteredList = list;

    // Filter to only orgs the authenticated user belongs to
    if (userId) {
      try {
        const accessibleOrgIds = await getAccessibleOrgIds(userId);
        if (accessibleOrgIds.length > 0) {
          const accessSet = new Set(accessibleOrgIds);
          filteredList = list.filter((o) => {
            const id = orgSortKeyToId(String(o[SK_NAME]));
            return accessSet.has(id);
          });
        }
        // If no memberships found, return all orgs (super-admin / first-time setup)
      } catch (err) {
        console.warn('Failed to filter orgs by user membership:', (err as Error)?.message);
        // On error, return all orgs rather than nothing
      }
    }

    const result = await Promise.all(
      filteredList.map((org) => enrichOrganizationWithCounts(org)),
    );

    return apiResponse(200, result);
  } catch (err) {
    console.error('Error in organizations handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export async function listOrganizations() {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :orgPk',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
        },
        ExpressionAttributeValues: {
          ':orgPk': ORG_PK,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items && res.Items.length > 0) {
      items.push(...res.Items);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (ExclusiveStartKey);

  return items;
}

type OrgItem = {
  sort_key: string;
  [key: string]: any;
};

const enrichOrganizationWithCounts = async (org: OrgItem) => {
  const orgId = orgSortKeyToId(org.sort_key);

  const [projectsCount, usersCount] = await Promise.all([
    getProjectCountForOrg(orgId),
    getUserCountForOrg(orgId),
  ]);

  const count = {
    organizationUsers: usersCount,
    projects: projectsCount,
  };

  return {
    ...org,
    _count: count,
    id: orgId,
  };
};

const orgSortKeyToId = (sortKey: string) => {
  return safeSplitAt(sortKey, '#', 1);
};

async function getProjectCountForOrg(orgId: string): Promise<number> {
  let count = 0;
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  const skPrefix = `${orgId}#`;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression:
          '#pk = :projectPk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':projectPk': PROJECT_PK,
          ':skPrefix': skPrefix,
        },
        Select: 'COUNT',
        ExclusiveStartKey,
      }),
    );

    count += res.Count ?? 0;
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (ExclusiveStartKey);

  return count;
}

async function getUserCountForOrg(orgId: string): Promise<number> {
  let count = 0;
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  const skPrefix = `ORG#${orgId}#USER#`;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression:
          '#pk = :orgPk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':orgPk': USER_PK,
          ':skPrefix': skPrefix,
        },
        Select: 'COUNT',
        ExclusiveStartKey,
      }),
    );

    count += res.Count ?? 0;
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (ExclusiveStartKey);

  return count;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:read'))
    .use(httpErrorMiddleware())
);