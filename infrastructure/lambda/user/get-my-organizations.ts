import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { QueryCommand, GetCommand, } from '@aws-sdk/lib-dynamodb';
import { apiResponse, getUserId } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PK } from '../constants/user';
import { ORG_PK } from '../constants/organization';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const GSI_BY_USER_ID = 'byUserId';

interface MyOrganization {
  orgId: string;
  orgName: string;
  role: string;
  joinedAt: string;
}

/**
 * GET /user/get-my-organizations
 *
 * Returns all organizations the authenticated user belongs to.
 * Uses the byUserId GSI to efficiently query user membership records.
 */
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return apiResponse(401, { message: 'Authentication required' });
    }

    // Query the GSI to find all USER records for this userId
    const memberships: Array<{ orgId: string; role: string; createdAt: string }> = [];
    let ExclusiveStartKey: Record<string, any> | undefined;

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
            orgId: item.orgId,
            role: item.role || 'VIEWER',
            createdAt: item.createdAt || '',
          });
        }
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    // Fetch org details for each membership
    const organizations: MyOrganization[] = [];

    for (const membership of memberships) {
      try {
        const orgRes = await docClient.send(
          new GetCommand({
            TableName: DB_TABLE_NAME,
            Key: {
              [PK_NAME]: ORG_PK,
              [SK_NAME]: `ORG#${membership.orgId}`,
            },
            ProjectionExpression: '#name, id',
            ExpressionAttributeNames: { '#name': 'name' },
          }),
        );

        organizations.push({
          orgId: membership.orgId,
          orgName: orgRes.Item?.name || 'Unknown',
          role: membership.role,
          joinedAt: membership.createdAt,
        });
      } catch {
        // Org may have been deleted — skip
        console.warn(`Org ${membership.orgId} not found for user ${userId}`);
      }
    }

    // Fetch user preferences to get lastOrgId
    let lastOrgId: string | null = null;
    try {
      const prefsRes = await docClient.send(
        new GetCommand({
          TableName: DB_TABLE_NAME,
          Key: {
            [PK_NAME]: USER_PK,
            [SK_NAME]: `PREFS#${userId}`,
          },
          ProjectionExpression: 'lastOrgId',
        }),
      );
      lastOrgId = prefsRes.Item?.lastOrgId ?? null;
    } catch {
      // Preferences record may not exist yet — that's fine
    }

    return apiResponse(200, { organizations, lastOrgId });
  } catch (err) {
    console.error('Error in get-my-organizations:', err);
    return apiResponse(500, {
      message: 'Failed to get organizations',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware()),
);
