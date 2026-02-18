import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { CreateUserDTOSchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { createUser, addExistingUserToOrg } from '@/helpers/user';
import { adminGetUser } from '@/helpers/cognito';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const cognito = new CognitoIdentityProviderClient({});

const TABLE = requireEnv('DB_TABLE_NAME');
const USER_POOL_ID = requireEnv('COGNITO_USER_POOL_ID');

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event?.body || '');
  const { success, data, error: errors } = CreateUserDTOSchema.safeParse(raw);
  
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: errors.issues });
  }

  const dto = data;

  try {
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
    // User already exists in Cognito (different org) — add to current org
    if (err?.message === 'COGNITO_USERNAME_EXISTS') {
      try {
        const emailLower = dto.email.trim().toLowerCase();
        const existingUser = await adminGetUser(cognito, {
          userPoolId: USER_POOL_ID,
          username: emailLower,
        });

        if (!existingUser) {
          return apiResponse(500, { message: 'User exists in Cognito but could not be retrieved' });
        }

        const { item } = await addExistingUserToOrg(
          {
            ddb,
            cognito,
            tableName: TABLE,
            userPoolId: USER_POOL_ID,
          },
          { dto, existingCognitoSub: existingUser.sub },
        );

        console.log(`Added existing Cognito user ${emailLower} (sub: ${existingUser.sub}) to org ${dto.orgId}`);

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
          addedToExistingUser: true,
        });
      } catch (addErr: any) {
        if (addErr?.name === 'ConditionalCheckFailedException') {
          return apiResponse(409, { message: 'User already exists in this organization' });
        }
        console.error('Failed to add existing Cognito user to org:', addErr);
        return apiResponse(500, { message: 'Failed to add existing user to organization' });
      }
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
