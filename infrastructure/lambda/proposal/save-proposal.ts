import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { PROPOSAL_PK } from '../constants/proposal';

import {
  type Proposal,
  ProposalSchema,
  ProposalStatus,
  type SaveProposalRequest,
  SaveProposalRequestSchema,
} from '@auto-rfp/shared';

// --- Dynamo client setup ---
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME environment variable is not set');

const proposalSkForProject = (projectId: string) => `${projectId}#PROPOSAL`;

export async function saveProposal(input: SaveProposalRequest): Promise<Proposal> {
  const now = new Date().toISOString();
  const sk = proposalSkForProject(input.projectId);

  // create-time id only
  const newId = input.id ?? uuidv4();

  const cmd = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: PROPOSAL_PK,
      [SK_NAME]: sk,
    },
    UpdateExpression: [
      'SET #id = if_not_exists(#id, :newId)',
      '#createdAt = if_not_exists(#createdAt, :now)',
      '#projectId = if_not_exists(#projectId, :projectId)',
      '#updatedAt = :now',
      '#organizationId = :organizationId',
      '#status = :status',
      '#title = :title',
      '#document = :document',
    ].join(', '),
    ExpressionAttributeNames: {
      '#id': 'id',
      '#createdAt': 'createdAt',
      '#updatedAt': 'updatedAt',
      '#projectId': 'projectId',
      '#organizationId': 'organizationId',
      '#status': 'status',
      '#title': 'title',
      '#document': 'document',
    },
    ExpressionAttributeValues: {
      ':newId': newId,
      ':now': now,
      ':projectId': input.projectId,
      ':organizationId': input.organizationId ?? null,
      ':status': input.status ?? ProposalStatus.NEW,
      ':title': input.title ?? input.document.proposalTitle ?? null,
      ':document': input.document,
    },
    ReturnValues: 'ALL_NEW',
  });

  const res = await docClient.send(cmd);
  const attrs = res.Attributes as unknown;

  // Validate/normalize output with shared ProposalSchema
  const parsed = ProposalSchema.safeParse(attrs);
  if (!parsed.success) {
    // keep debugging info but don't crash silently
    console.error('Saved proposal failed schema validation', parsed.error, attrs);
    throw new Error('Saved proposal has invalid shape in DB (does not match ProposalSchema)');
  }

  return parsed.data;
}

// ------------------- Lambda handler -------------------

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    let raw: unknown;
    try {
      raw = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    // ✅ validate request using shared schema
    const parsed = SaveProposalRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return apiResponse(400, {
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const saved = await saveProposal(parsed.data);
    return apiResponse(200, saved);
  } catch (err) {
    console.error('Error in saveProposal handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);