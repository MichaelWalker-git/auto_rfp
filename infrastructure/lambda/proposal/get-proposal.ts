import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { PROPOSAL_PK } from '../constants/proposal';

import { ProposalSchema } from '@auto-rfp/shared';
import { proposalSK } from '../helpers/proposal';
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

const QuerySchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  proposalId: z.string().min(1).optional(),
});

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

    let item: any | null = null;

    if (proposalId) {
      item = await getItem(PROPOSAL_PK, proposalSK(projectId, proposalId));
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

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware())
);
