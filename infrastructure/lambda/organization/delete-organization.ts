import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DeleteCommand, } from '@aws-sdk/lib-dynamodb';
import { ORG_PK } from '../constants/organization';
import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import { requireEnv } from '../helpers/env';
import middy from '@middy/core';
import { docClient } from '../helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.id;

    if (!orgId) {
      return apiResponse(400, { message: 'Missing required path parameter: id' });
    }

    await deleteOrganization(orgId);

    return apiResponse(200, {
      success: true,
      message: 'Organization deleted successfully',
      id: orgId,
    });
  } catch (err: any) {
    console.error('Error in deleteOrganization handler:', err);

    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Organization not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export async function deleteOrganization(orgId: string): Promise<void> {
  const key = {
    [PK_NAME]: ORG_PK,
    [SK_NAME]: `ORG#${orgId}`,
  };

  const command = new DeleteCommand({
    TableName: DB_TABLE_NAME,
    Key: key,
    ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
  });

  await docClient.send(command);
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:delete'))
    .use(httpErrorMiddleware())
);