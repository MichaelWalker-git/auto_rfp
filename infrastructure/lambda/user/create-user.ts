import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuidv4 } from 'uuid';

import { apiResponse } from '../helpers/api';
import { createUser } from '../helpers/user';
import middy from '@middy/core';

import { type CreateUserDTO, CreateUserDTOSchema } from '@auto-rfp/shared';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import { requireEnv } from '../helpers/env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const cognito = new CognitoIdentityProviderClient({});

const TABLE = requireEnv('DB_TABLE_NAME');
const USER_POOL_ID = requireEnv('COGNITO_USER_POOL_ID');

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = JSON.parse(event?.body || '');
    const dto: CreateUserDTO = CreateUserDTOSchema.parse(raw);

    const userId = uuidv4();
    const createdAtIso = new Date().toISOString();

    const { item } = await createUser(
      {
        ddb,
        cognito,
        tableName: TABLE,
        userPoolId: USER_POOL_ID,
      },
      { dto, userId, createdAtIso },
      {
        sendCognitoInvite: true,
        markEmailVerified: true,
      },
    );

    return apiResponse(201, {
      orgId: item.orgId,
      userId: item.userId,
      email: item.email,
      firstName: item.firstName,
      lastName: item.lastName,
      displayName: item.displayName,
      phone: item.phone,
      role: item.role,
      status: item.status,
      cognitoUsername: item.cognitoUsername,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return apiResponse(400, { message: 'Invalid payload', issues: err.issues });
    }

    // thrown by helpers/cognito.ts
    if (err?.message === 'COGNITO_USERNAME_EXISTS') {
      return apiResponse(409, { message: 'Cognito user already exists' });
    }

    // thrown by Dynamo condition
    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(409, { message: 'User already exists' });
    }

    console.error('create-user error:', err);
    return apiResponse(500, { message: 'Internal Server Error' });
  }
};


export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('user:create'))
    .use(httpErrorMiddleware())
);