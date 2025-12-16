import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { PROPOSAL_PK } from '../constants/proposal';

import { ProposalSchema } from '@auto-rfp/shared';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME environment variable is not set');

const QuerySchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  proposalId: z.string().min(1).optional(),
});

const skLegacy = (projectId: string) => `${projectId}#PROPOSAL`;

const skById = (projectId: string, proposalId: string) => `${projectId}#PROPOSAL#${proposalId}`;

function toProposalEntity(item: any) {
  const document = item.document ?? item.proposal;

  const candidate = {
    id: item.id,
    projectId: item.projectId,
    organizationId: item.organizationId ?? null,
    status: item.status,
    title: item.title ?? document?.proposalTitle ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    document,
  };

  const parsed = ProposalSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false as const, issues: parsed.error.format(), raw: candidate };
  }
  return { ok: true as const, data: parsed.data };
}

async function getItem(pk: string, sk: string) {
  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: pk,
      [SK_NAME]: sk,
    },
  });

  const res = await docClient.send(cmd);
  return res.Item ?? null;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const qs = event.queryStringParameters ?? {};
    const parsed = QuerySchema.safeParse(qs);

    if (!parsed.success) {
      return apiResponse(400, {
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const { projectId, proposalId } = parsed.data;

    // 1) Try the recommended SK shape first (if proposalId provided)
    let item: any | null = null;

    if (proposalId) {
      item = await getItem(PROPOSAL_PK, skById(projectId, proposalId));
    }

    // 2) Fallback to legacy "one per project" key
    if (!item) {
      item = await getItem(PROPOSAL_PK, skLegacy(projectId));
    }

    if (!item) {
      return apiResponse(404, { message: 'Proposal not found' });
    }

    const mapped = toProposalEntity(item);
    if (!mapped.ok) {
      console.error('Stored proposal failed validation', mapped.issues, mapped.raw);
      return apiResponse(502, {
        message: 'Stored proposal is not a valid Proposal entity',
        issues: mapped.issues,
      });
    }

    return apiResponse(200, mapped.data);
  } catch (err) {
    console.error('Error in get-proposal handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
