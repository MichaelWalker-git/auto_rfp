import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { USER_PK } from '@/constants/user';
import { requireEnv } from '@/helpers/env';
import { userSk } from '@/helpers/user';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { safeTrim, safeLowerCase } from '@/helpers/safe-string';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = requireEnv('DB_TABLE_NAME');

const encodeNextToken = (lek: Record<string, any>) =>
  Buffer.from(JSON.stringify(lek), 'utf8').toString('base64');
const decodeNextToken = (token: string) =>
  JSON.parse(Buffer.from(token, 'base64').toString('utf8'));

function asInt(v: string | undefined, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const qs = event.queryStringParameters ?? {};

    const orgId = qs.orgId;
    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    const limit = asInt(qs.limit, 50);

    const nextToken = qs.nextToken;
    const exclusiveStartKey = nextToken ? decodeNextToken(nextToken) : undefined;

    // optional filters (applied in Dynamo FilterExpression -> evaluated AFTER read)
    // Use safe string utils to handle edge cases where params might not be strings
    const search = safeLowerCase(safeTrim(qs.search)) || undefined;
    const role = safeTrim(qs.role) || undefined;
    const status = safeTrim(qs.status) || undefined;

    const expressionAttributeNames: Record<string, string> = {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    };
    const expressionAttributeValues: Record<string, any> = {
      ':pkValue': USER_PK,
      ':skPrefix': userSk(orgId, ''),
    };

    // Base query: PK = USER_PK AND begins_with(SK, ORG#<orgId>#USER#)
    let filterExpressionParts: string[] = [];

    // We store `searchText` lowercased in item for naive contains filtering
    if (search) {
      expressionAttributeNames['#searchText'] = 'searchText';
      expressionAttributeValues[':search'] = search;
      filterExpressionParts.push('contains(#searchText, :search)');
    }

    if (role) {
      expressionAttributeNames['#role'] = 'role';
      expressionAttributeValues[':role'] = role;
      filterExpressionParts.push('contains(#role, :role)');
    }

    if (status) {
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = status;
      filterExpressionParts.push('#status = :status');
    }

    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: '#pk = :pkValue AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(filterExpressionParts.length
          ? { FilterExpression: filterExpressionParts.join(' AND ') }
          : {}),
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = (res.Items ?? []).map((it: any) => ({
      orgId: it.orgId,
      userId: it.userId,
      email: it.email,
      firstName: it.firstName,
      lastName: it.lastName,
      displayName: it.displayName,
      phone: it.phone,
      role: it.role,
      status: it.status,
      cognitoUsername: it.cognitoUsername,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    }));

    return apiResponse(200, {
      items,
      nextToken: res.LastEvaluatedKey ? encodeNextToken(res.LastEvaluatedKey) : undefined,
      count: items.length,
    });
  } catch (err: any) {
    // Bad nextToken (base64/json)
    if (err?.name === 'SyntaxError') {
      return apiResponse(400, { message: 'Invalid nextToken' });
    }
    console.error('list-users error:', err);
    return apiResponse(500, { message: 'Internal Server Error' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('user:read'))
    .use(httpErrorMiddleware())
);