import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { apiResponse, getOrgId } from '../helpers/api';

import { PK_NAME, SK_NAME } from '../constants/common';
import { SYSTEM_PROMPT_PK, USER_PROMPT_PK } from '../constants/prompt';

import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export async function queryPromptsByPkForOrg(pkValue: string, orgId: string) {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    try {
      const res: any = await docClient.send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
            '#sk': SK_NAME,
          },
          ExpressionAttributeValues: {
            ':pk': pkValue,
            ':skPrefix': `${orgId}#`,
          },
          ExclusiveStartKey,
        }),
      );

      if (Array.isArray(res?.Items) && res.Items.length) items.push(...res.Items);
      ExclusiveStartKey = res?.LastEvaluatedKey;
    } catch (e: any) {
      console.error('DDB Query failed', {
        message: e?.message,
        name: e?.name,
        pkValue,
        orgId,
        table: DB_TABLE_NAME,
      });
      throw e;
    }
  } while (ExclusiveStartKey);

  return items;
}

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { ok: false, error: 'Missing required orgId' });
  }

  const [system, user] = await Promise.all([
    queryPromptsByPkForOrg(SYSTEM_PROMPT_PK, orgId),
    queryPromptsByPkForOrg(USER_PROMPT_PK, orgId),
  ]);

  return apiResponse(200, {
    ok: true,
    items: {
      system: system ?? [],
      user: user ?? [],
    },
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('prompt:read'))
    .use(httpErrorMiddleware()),
);