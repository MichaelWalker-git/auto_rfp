import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { ORG_PK } from '@/constants/organization';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { apiResponse, getUserId } from '@/helpers/api';
import { OrganizationItem, UpdateOrganizationDTO, UpdateOrganizationSchema, } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import middy from '@middy/core';
import { docClient } from '@/helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const orgId = event.pathParameters?.id;

  if (!orgId) {
    return apiResponse(400, { message: 'Missing required path parameter: id' });
  }

  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    const validationResult = UpdateOrganizationSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues.map((issue: any) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const validatedOrgData: UpdateOrganizationDTO = validationResult.data;

    const userId = getUserId(event) ?? 'system';
    const updatedOrganization = await editOrganization(orgId, validatedOrgData, userId);

    return apiResponse(200, updatedOrganization);
  } catch (err) {
    console.error('Error in updateOrganization handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    if ((err as any)?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Organization not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export async function editOrganization(
  orgId: string,
  orgData: UpdateOrganizationDTO,
  userId: string = 'system',
): Promise<OrganizationItem> {
  const now = new Date().toISOString();

  const key = {
    [PK_NAME]: ORG_PK,
    [SK_NAME]: `ORG#${orgId}`,
  };

  const expressionAttributeNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
    '#pk': PK_NAME,
    '#sk': SK_NAME,
  };
  const expressionAttributeValues: Record<string, any> = {
    ':updatedAt': now,
  };

  const setExpressions: string[] = ['#updatedAt = :updatedAt', '#updatedBy = :updatedBy'];

  expressionAttributeNames['#updatedBy'] = 'updatedBy';
  expressionAttributeValues[':updatedBy'] = userId;

  if (orgData.name !== undefined) {
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = orgData.name;
    setExpressions.push('#name = :name');
  }

  if (orgData.description !== undefined) {
    expressionAttributeNames['#description'] = 'description';
    expressionAttributeValues[':description'] = orgData.description;
    setExpressions.push('#description = :description');
  }

  if (orgData.iconKey !== undefined) {
    expressionAttributeNames['#iconKey'] = 'iconKey';
    expressionAttributeValues[':iconKey'] = orgData.iconKey;
    setExpressions.push('#iconKey = :iconKey');
  }

  if (orgData.clusterThreshold !== undefined) {
    expressionAttributeNames['#clusterThreshold'] = 'clusterThreshold';
    expressionAttributeValues[':clusterThreshold'] = orgData.clusterThreshold;
    setExpressions.push('#clusterThreshold = :clusterThreshold');
  }

  if (orgData.similarThreshold !== undefined) {
    expressionAttributeNames['#similarThreshold'] = 'similarThreshold';
    expressionAttributeValues[':similarThreshold'] = orgData.similarThreshold;
    setExpressions.push('#similarThreshold = :similarThreshold');
  }

  if (setExpressions.length === 1) {
    // Only updatedAt would be updated – you can decide to allow or block this
    // For now, we allow it, so no early return.
  }

  const command = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: key,
    UpdateExpression: 'SET ' + setExpressions.join(', '),
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    // Ensure the org exists; otherwise throw ConditionalCheckFailedException
    ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
    ReturnValues: 'ALL_NEW',
  });

  const result = await docClient.send(command);

  return result.Attributes as OrganizationItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:edit'))
    .use(httpErrorMiddleware())
);
