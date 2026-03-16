import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { ResendTempPasswordRequestSchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { adminResendTempPassword, adminGetUser } from '@/helpers/cognito';
import { getUserByOrgAndId } from '@/helpers/user';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const cognito = new CognitoIdentityProviderClient({});

const USER_POOL_ID = requireEnv('COGNITO_USER_POOL_ID');

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event?.body || '');
  const { success, data, error: errors } = ResendTempPasswordRequestSchema.safeParse(raw);
  
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: errors.issues });
  }

  const { orgId, userId } = data;

  try {
    // 1. Get user from DynamoDB to verify they exist and get their email
    const user = await getUserByOrgAndId(orgId, userId);
    if (!user) {
      return apiResponse(404, { message: 'User not found' });
    }

    // 2. Get user from Cognito to verify they exist there too
    const cognitoUser = await adminGetUser(cognito, {
      userPoolId: USER_POOL_ID,
      username: user.email.toLowerCase(),
    });

    if (!cognitoUser) {
      return apiResponse(404, { message: 'User not found in authentication system' });
    }

    // 3. Resend temporary password
    await adminResendTempPassword(cognito, {
      userPoolId: USER_POOL_ID,
      username: user.email.toLowerCase(),
    });

    // 4. Set audit context
    setAuditContext(event, {
      action: 'USER_TEMP_PASSWORD_RESENT',
      resource: 'user',
      resourceId: userId,
      changes: { 
        after: { 
          email: user.email,
          orgId,
          userId,
        } 
      },
    });

    return apiResponse(200, {
      ok: true,
      orgId,
      userId,
      email: user.email,
      message: 'Temporary password has been resent successfully',
    });
  } catch (err: any) {
    console.error('resend-temp-password error:', err);
    
    if (err?.message === 'User not found') {
      return apiResponse(404, { message: 'User not found in authentication system' });
    }

    if (err?.message === 'User email not found') {
      return apiResponse(400, { message: 'User email not found' });
    }

    return apiResponse(500, { message: 'Failed to resend temporary password' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('user:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);