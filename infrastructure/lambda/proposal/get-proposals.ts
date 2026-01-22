import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { PROPOSAL_PK } from '../constants/proposal';

import {
  type Proposal,
  ProposalDocumentSchema,
  type ProposalListResponse,
  ProposalListResponseSchema,
  ProposalSchema,
  ProposalStatus,
} from '@auto-rfp/shared';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { proposalSK } from '../helpers/proposal';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const normalizeDbItemToProposal = (it: any, projectId: string): Proposal => {
  const rawDoc = it?.document ?? it?.proposal;

  const docParsed = ProposalDocumentSchema.safeParse(rawDoc);
  const document = docParsed.success
    ? docParsed.data
    : ({
      proposalTitle: it?.title ?? 'Proposal',
      sections: [
        {
          id: 'generated',
          title: 'Generated Proposal',
          subsections: [
            {
              id: 'content',
              title: 'Content',
              content: typeof rawDoc === 'string' ? rawDoc : JSON.stringify(rawDoc ?? {}, null, 2),
            },
          ],
        },
      ],
    } as any); // last-resort fallback if DB contains invalid doc

  const proposalCandidate: Proposal = {
    id: String(it?.id ?? ''),
    projectId: String(it?.projectId ?? projectId),
    organizationId: it?.organizationId ?? null,
    status: (it?.status as ProposalStatus) ?? ProposalStatus.NEW,
    title: it?.title ?? document.proposalTitle ?? null,
    createdAt: String(it?.createdAt ?? ''),
    updatedAt: String(it?.updatedAt ?? ''),
    document: document
  };

  // Validate final entity
  const parsed = ProposalSchema.safeParse(proposalCandidate);
  if (!parsed.success) {
    console.error('Invalid Proposal entity after normalization', parsed.error, { it });
    // Throw to fail loudly; otherwise UI gets inconsistent data
    throw new Error('Invalid proposal item in DB (does not match ProposalSchema)');
  }

  // If includeDocument=false and you want to reduce payload size:
  // You can return a smaller object, BUT then it won't match ProposalSchema.
  // Recommended: keep ProposalSchema for "full" responses and create a ProposalMetaSchema for list-only.
  return parsed.data;
};

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId } = event.queryStringParameters ?? {};

    if (!projectId) {
      return apiResponse(400, {
        message: 'Project ID is required',
      });
    }

    const cmd = new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: {
        ':pk': PROPOSAL_PK,
        ':skPrefix': proposalSK(projectId, ''),
      },
      ScanIndexForward: false,
      Limit: 50,
    });

    const res = await docClient.send(cmd);
    const items = res.Items ?? [];

    const normalized: Proposal[] = items.map((it: any) =>
      normalizeDbItemToProposal(it, projectId),
    );

    const response: ProposalListResponse = {
      items: normalized,
      count: normalized.length,
    };

    // Final response validation (optional but nice)
    const outParsed = ProposalListResponseSchema.safeParse(response);
    if (!outParsed.success) {
      console.error('Invalid ProposalListResponse', outParsed.error, response);
      return apiResponse(500, { message: 'Invalid response shape from get-proposals' });
    }

    return apiResponse(200, outParsed.data);
  } catch (err) {
    console.error('Error in get-proposals handler:', err);
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