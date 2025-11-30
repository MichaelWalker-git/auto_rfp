import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { ORG_PK } from '../constants/organization';
import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { OrganizationItem, UpdateOrganizationDTO, UpdateOrganizationSchema, } from '../schemas/organization';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}

// --- Main Handler ---
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const orgId = event.pathParameters?.id;

  if (!orgId) {
    return apiResponse(400, { message: 'Missing required path parameter: orgId' });
  }

  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Runtime Validation using Zod (partial update)
    const validationResult = UpdateOrganizationSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const validatedOrgData: UpdateOrganizationDTO = validationResult.data;

    // 2. Perform update
    const updatedOrganization = await editOrganization(orgId, validatedOrgData);

    return apiResponse(200, updatedOrganization);
  } catch (err) {
    console.error('Error in updateOrganization handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    // Conditional check failed → organization not found
    if ((err as any)?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Organization not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};


// --- Business Logic Function ---
// orgData is partial (PATCH-like) thanks to UpdateOrganizationSchema
export async function editOrganization(
  orgId: string,
  orgData: UpdateOrganizationDTO
): Promise<OrganizationItem> {
  const now = new Date().toISOString();

  const key = {
    [PK_NAME]: ORG_PK,
    [SK_NAME]: `ORG#${orgId}`,
  };

  // Build a dynamic UpdateExpression so you can update any subset of fields
  const expressionAttributeNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':updatedAt': now,
  };

  const setExpressions: string[] = ['#updatedAt = :updatedAt'];

  // Example for common fields; add more as needed
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
