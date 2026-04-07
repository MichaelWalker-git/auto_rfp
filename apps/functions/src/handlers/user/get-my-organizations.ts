import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { apiResponse, getUserId } from '@/helpers/api';
import { PK_NAME } from '@/constants/common';
import { USER_PK } from '@/constants/user';
import { ORG_PK } from '@/constants/organization';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '@/helpers/env';
import { docClient, getItem } from '@/helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const GSI_BY_USER_ID = 'byUserId';

interface Membership {
  orgId: string;
  role: string;
  createdAt: string;
}

interface OrgRecord {
  name?: string;
}

interface PrefsRecord {
  lastOrgId?: string;
}

interface MyOrganization {
  orgId: string;
  orgName: string;
  role: string;
  joinedAt: string;
}

const getUserMemberships = async (userId: string): Promise<Membership[]> => {
  const memberships: Membership[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        IndexName: GSI_BY_USER_ID,
        KeyConditionExpression: '#userId = :userId AND #pk = :pk',
        ExpressionAttributeNames: {
          '#userId': 'userId',
          '#pk': PK_NAME,
          '#role': 'role',
        },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':pk': USER_PK,
        },
        ProjectionExpression: 'orgId, #role, createdAt',
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      if (item.orgId) {
        memberships.push({
          orgId: item.orgId as string,
          role: (item.role as string) || 'VIEWER',
          createdAt: (item.createdAt as string) || '',
        });
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return memberships;
};

/**
 * GET /user/get-my-organizations
 *
 * Returns all organizations the authenticated user belongs to.
 * Uses the byUserId GSI to efficiently query user membership records.
 */
export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  const userId = getUserId(event);
  if (!userId) {
    return apiResponse(401, { message: 'Authentication required' });
  }

  const memberships = await getUserMemberships(userId);

  // Fetch org details and user preferences in parallel
  const [orgRecords, prefs] = await Promise.all([
    Promise.all(
      memberships.map((m) => getItem<OrgRecord>(ORG_PK, `ORG#${m.orgId}`)),
    ),
    getItem<PrefsRecord>(USER_PK, `PREFS#${userId}`),
  ]);

  const organizations: MyOrganization[] = memberships.map((m, i) => ({
    orgId: m.orgId,
    orgName: orgRecords[i]?.name || 'Unknown',
    role: m.role,
    joinedAt: m.createdAt,
  }));

  return apiResponse(200, { organizations, lastOrgId: prefs?.lastOrgId ?? null });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware()),
);