import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { withSentryLambda } from '../sentry-lambda';
import { PK_NAME, SK_NAME } from '../constants/common';
import { PROPOSAL_PK } from '../constants/proposal';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const DeleteProposalRequestSchema = z.object({
  projectId: z.string().min(1),
  proposalId: z.string().min(1),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const parsed = DeleteProposalRequestSchema.parse(bodyJson);
    const { projectId, proposalId } = parsed;

    // Delete the proposal from DynamoDB
    // SK format: "<projectId>#<proposalId>"
    const sk = `${projectId}#${proposalId}`;

    await docClient.send(
      new DeleteCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: PROPOSAL_PK,
          [SK_NAME]: sk,
        },
      })
    );

    console.log(`Deleted proposal: ${proposalId} from project: ${projectId}`);

    return apiResponse(200, {
      ok: true,
      message: 'Proposal deleted successfully',
      proposalId,
      projectId,
    });
  } catch (err) {
    console.error('delete-proposal error:', err);

    if (err instanceof z.ZodError) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: err.errors,
      });
    }

    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);