import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { PutCommand, } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { CreateOrganizationSchema } from '@auto-rfp/core';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { USER_PK } from '@/constants/user';
import { apiResponse, getUserId } from '@/helpers/api';
import { userSk } from '@/helpers/user';
import { createOrganization } from '@/helpers/org';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    const { success, data, error: errors } = CreateOrganizationSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = errors.issues.map((issue: any) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const userId = getUserId(event);
    const userEmail = (event as any).auth?.claims?.email ?? '';

    const newOrganization = await createOrganization(data);

    // Auto-add the creating user as an ADMIN member of the new org
    if (userId && newOrganization.id) {
      try {
        const now = new Date().toISOString();
        await docClient.send(
          new PutCommand({
            TableName: DB_TABLE_NAME,
            Item: {
              [PK_NAME]: USER_PK,
              [SK_NAME]: userSk(newOrganization.id, userId),
              entityType: 'USER',
              orgId: newOrganization.id,
              userId,
              email: userEmail,
              role: 'ADMIN',
              status: 'ACTIVE',
              createdAt: now,
              updatedAt: now,
            },
          }),
        );
      } catch (membershipErr) {
        // Log but don't fail the org creation
        console.error('Failed to add creator as org member:', membershipErr);
      }
    }

    return apiResponse(201, newOrganization);

  } catch (err) {
    console.error('Error in createOrganization handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:create'))
    .use(httpErrorMiddleware())
);