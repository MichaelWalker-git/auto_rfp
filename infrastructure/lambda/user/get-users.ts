import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PK } from '../constants/user';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = process.env.DB_TABLE_NAME!;
if (!TABLE) throw new Error('DB_TABLE_NAME is required');

const skPrefix = (orgId: string) => `ORG#${orgId}#USER#`;
const encodeNextToken = (lek: Record<string, any>) =>
  Buffer.from(JSON.stringify(lek), 'utf8').toString('base64');
const decodeNextToken = (token: string) =>
  JSON.parse(Buffer.from(token, 'base64').toString('utf8'));

function asInt(v: string | undefined, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const qs = event.queryStringParameters ?? {};

    const orgId = qs.orgId;
    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    const limit = asInt(qs.limit, 50);

    const nextToken = qs.nextToken;
    const exclusiveStartKey = nextToken ? decodeNextToken(nextToken) : undefined;

    // optional filters (applied in Dynamo FilterExpression -> evaluated AFTER read)
    const search = qs.search?.trim().toLowerCase();
    const role = qs.role?.trim();
    const status = qs.status?.trim();

    const expressionAttributeNames: Record<string, string> = {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    };
    const expressionAttributeValues: Record<string, any> = {
      ':pkValue': USER_PK,
      ':skPrefix': skPrefix(orgId),
    };

    // Base query: PK = USER_PK AND begins_with(SK, ORG#<orgId>#USER#)
    let filterExpressionParts: string[] = [];

    // We store `searchText` lowercased in item for naive contains filtering
    if (search) {
      expressionAttributeNames['#searchText'] = 'searchText';
      expressionAttributeValues[':search'] = search;
      filterExpressionParts.push('contains(#searchText, :search)');
    }

    // roles is an array; contains(list, element) works
    if (role) {
      expressionAttributeNames['#roles'] = 'roles';
      expressionAttributeValues[':role'] = role;
      filterExpressionParts.push('contains(#roles, :role)');
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
      roles: it.roles,
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
