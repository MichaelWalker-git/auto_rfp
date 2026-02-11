import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { PutCommand, } from '@aws-sdk/lib-dynamodb';
import { ORG_PK } from '../constants/organization';
import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse, getUserId } from '../helpers/api';
import { createAuditFields } from '../helpers/audit';
import { v4 as uuidv4 } from 'uuid';
import { CreateOrganizationDTO, CreateOrganizationSchema, OrganizationItem, } from '../schemas/organization';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Runtime Validation using Zod
    const validationResult = CreateOrganizationSchema.safeParse(rawBody);

    if (!validationResult.success) {
      // Zod handles all validation details and provides a clean error object
      const errorDetails = validationResult.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    // The data is now guaranteed to match the CreateOrganizationDTO type
    const validatedOrgData: CreateOrganizationDTO = validationResult.data;

    const newOrganization = await createOrganization(validatedOrgData);

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


// --- Business Logic Function ---
// The input is guaranteed to be a CreateOrganizationDTO thanks to Zod validation
export async function createOrganization(orgData: CreateOrganizationDTO): Promise<OrganizationItem> {
  const now = new Date().toISOString();
  const orgId = uuidv4();

  const organizationItem: OrganizationItem = {
    [PK_NAME]: ORG_PK,
    [SK_NAME]: `ORG#${orgId}`,
    ...orgData, // Spread the validated { name, description } fields
    createdAt: now,
    updatedAt: now,
  } as OrganizationItem; // Type assertion is safe here because Zod schema matches

  const command = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: organizationItem,
  });

  await docClient.send(command);

  return { ...organizationItem, id: orgId };
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:create'))
    .use(httpErrorMiddleware())
);