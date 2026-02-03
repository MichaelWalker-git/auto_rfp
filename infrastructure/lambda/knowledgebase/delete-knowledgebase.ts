import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DeleteCommand, } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse, getOrgId } from '../helpers/api';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const tokenOrgId = getOrgId(event);
    const { orgId: bodyOrgId, id: kbId} = JSON.parse(event.body || '');
    const orgId = tokenOrgId ? tokenOrgId : bodyOrgId;

    const sk = `${orgId}#${kbId}`;

    try {
      await docClient.send(
        new DeleteCommand({
          TableName: DB_TABLE_NAME,
          Key: {
            [PK_NAME]: KNOWLEDGE_BASE_PK,
            [SK_NAME]: sk,
          },
          ConditionExpression: 'attribute_exists(#pk)',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
          },
        }),
      );
    } catch (err: any) {
      // ConditionalCheckFailedException -> item not found
      if (err?.name === 'ConditionalCheckFailedException') {
        return apiResponse(404, {
          message: 'Knowledge base not found',
          orgId,
          kbId,
        });
      }

      console.error('Error deleting knowledge base:', err);
      return apiResponse(500, {
        message: 'Failed to delete knowledge base',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    return apiResponse(200, {
      message: 'Knowledge base deleted successfully',
      orgId,
      kbId,
    });
  } catch (err) {
    console.error('Unhandled error in deleteKnowledgeBase handler:', err);
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
    .use(requirePermission('kb:delete'))
    .use(httpErrorMiddleware())
);
