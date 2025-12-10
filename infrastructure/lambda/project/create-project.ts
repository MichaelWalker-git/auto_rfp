import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

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

// --------- Zod schema & types ---------

export const CreateProjectSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
});

export type CreateProjectDTO = z.infer<typeof CreateProjectSchema>;

export type ProjectItem = CreateProjectDTO & {
  [PK_NAME]: string;
  [SK_NAME]: string;
  id: string;
  createdAt: string;
  updatedAt: string;
};

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Validate with Zod
    const validationResult = CreateProjectSchema.safeParse(rawBody);

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

    const dto: CreateProjectDTO = validationResult.data;

    // 2. Create project
    const project = await createProject(dto);

    return apiResponse(201, project);
  } catch (err) {
    console.error('Error in createProject handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// --------- Business logic ---------

export async function createProject(dto: CreateProjectDTO): Promise<ProjectItem> {
  const { orgId, name, description } = dto;

  const now = new Date().toISOString();
  const projectId = uuidv4();

  // Composite sort key: orgId + projectId
  // Compatible with listProjects() which uses begins_with(SK, orgId)
  const sortKey = `${orgId}#${projectId}`;

  const projectItem: ProjectItem = {
    [PK_NAME]: PROJECT_PK,
    [SK_NAME]: sortKey,
    id: projectId,
    orgId,
    name,
    description,
    createdAt: now,
    updatedAt: now,
  };

  const cmd = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: projectItem,
    // Optional safety: don't overwrite if somehow exists already
    ConditionExpression:
      'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
  });

  await docClient.send(cmd);

  return projectItem;
}

export const handler = withSentryLambda(baseHandler);