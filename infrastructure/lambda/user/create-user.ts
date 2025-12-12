import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, } from '@aws-sdk/lib-dynamodb';
import { AdminCreateUserCommand, CognitoIdentityProviderClient, } from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PK } from '../constants/user'; // or SECURITY_STAFF_PK if you have it
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const cognitoClient = new CognitoIdentityProviderClient({});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const USER_POOL_ID = process.env.USER_POOL_ID;
const USER_BY_EMAIL_INDEX = process.env.USER_BY_EMAIL_INDEX || 'USER_BY_EMAIL_INDEX';

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}
if (!USER_POOL_ID) {
  throw new Error('USER_POOL_ID environment variable is not set');
}

// ---------- ZOD SCHEMA ----------

// No password here – password handled fully in Cognito, not stored in DB
export const CreateSecurityStaffSchema = z.object({
  email: z.string().email('Email must be valid'),
  name: z.string().min(1, 'Name is required'),
  organizationId: z.string().optional(), // optional, if you group staff by org
});

export type CreateSecurityStaffDTO = z.infer<typeof CreateSecurityStaffSchema>;

export type SecurityStaffItem = CreateSecurityStaffDTO & {
  [PK_NAME]: string;
  [SK_NAME]: string;
  id: string; // internal user id (Cognito sub)
  createdAt: string;
  updatedAt: string;
  cognitoUsername: string;
  role: 'SECURITY_STAFF';
};

// ---------- HANDLER ----------

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Validate request body
    const validationResult = CreateSecurityStaffSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const dto: CreateSecurityStaffDTO = validationResult.data;

    // 2. Ensure user with this email does NOT already exist in our table
    const alreadyExists = await userExistsByEmail(dto.email);
    if (alreadyExists) {
      return apiResponse(409, {
        message: `User with email ${dto.email} already exists`,
      });
    }

    // 3. Create user in Cognito and store metadata in DynamoDB
    const staff = await createSecurityStaffInCognitoAndDynamo(dto);

    return apiResponse(201, staff);
  } catch (err) {
    console.error('Error in createSecurityStaff handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// ---------- BUSINESS LOGIC ----------

// Check via GSI that no user with this email exists yet
async function userExistsByEmail(email: string): Promise<boolean> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      IndexName: USER_BY_EMAIL_INDEX, // GSI with PK = "email"
      KeyConditionExpression: '#email = :email',
      ExpressionAttributeNames: {
        '#email': 'email',
      },
      ExpressionAttributeValues: {
        ':email': email,
      },
      Limit: 1,
    }),
  );

  return !!(res.Items && res.Items.length > 0);
}

async function createSecurityStaffInCognitoAndDynamo(
  dto: CreateSecurityStaffDTO,
): Promise<SecurityStaffItem> {
  const { email, name, organizationId } = dto;
  const now = new Date().toISOString();

  // We’ll use email as Cognito username as well
  const username = email;

  // 1. Create user in Cognito
  // No password parameter here – Cognito will send a temporary password / invitation
  // (you can configure this behavior in the User Pool settings)
  const createCmd = new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID!,
    Username: username,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: name },
    ],
    // Let Cognito send invite message with temporary password
    // Remove this line if you want the default invite behavior
    // MessageAction: 'SUPPRESS',
  });

  const createRes = await cognitoClient.send(createCmd);

  const subAttr = createRes.User?.Attributes?.find((a) => a.Name === 'sub');
  const userId = subAttr?.Value ?? uuidv4();

  // 2. Store only metadata in DynamoDB (no password, just for listing)
  const staffItem: SecurityStaffItem = {
    [PK_NAME]: USER_PK,                  // or SECURITY_STAFF_PK if you prefer
    [SK_NAME]: `USER#${userId}`,         // you can also use `SEC_STAFF#${userId}`
    id: userId,
    email,
    name,
    organizationId: organizationId,
    createdAt: now,
    updatedAt: now,
    cognitoUsername: username,
    role: 'SECURITY_STAFF',
  };

  const putCmd = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: staffItem,
    // Extra safety: don't overwrite an existing PK/SK
    ConditionExpression:
      'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
  });

  await docClient.send(putCmd);

  return staffItem;
}

export const handler = withSentryLambda(baseHandler);