import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { SAVED_SEARCH_PK } from '@/constants/samgov';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

function decodeId(id?: string) {
  try {
    return id ? decodeURIComponent(id) : '';
  } catch {
    return id ?? '';
  }
}

// ---------------- handler ----------------
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgIdFromAuth = (event as any)?.auth?.orgId as string | undefined;

    const orgId =
      (event.queryStringParameters?.orgId ?? orgIdFromAuth ?? '').trim();

    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    // prevent deleting other orgs
    if (orgIdFromAuth && event.queryStringParameters?.orgId && orgId !== orgIdFromAuth) {
      return apiResponse(403, { message: 'orgId mismatch' });
    }

    const savedSearchId = decodeId(event.pathParameters?.id);

    if (!savedSearchId) {
      return apiResponse(400, { message: 'savedSearchId is required in path' });
    }

    const pk = SAVED_SEARCH_PK;
    const sk = `${orgId}#${savedSearchId}`;

    await docClient.send(
      new DeleteCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: pk,
          [SK_NAME]: sk,
        },
        // ensure it exists (otherwise DynamoDB delete is "successful" even if missing)
        ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
      }),
    );

    return apiResponse(200, { ok: true, savedSearchId });
  } catch (err: any) {
    // DynamoDB conditional check failed => not found
    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Saved search not found' });
    }

    console.error('Error in delete-saved-search:', err);
    return apiResponse(500, {
      message: 'Failed to delete saved search',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:delete'))
    .use(httpErrorMiddleware()),
);