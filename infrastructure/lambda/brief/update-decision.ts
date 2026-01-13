import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { PK_NAME, SK_NAME } from '../constants/common';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  decision: z.enum(['GO', 'NO_GO']),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const { executiveBriefId, decision } = RequestSchema.parse(bodyJson);

    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: EXEC_BRIEF_PK,
          [SK_NAME]: executiveBriefId,
        },
        UpdateExpression: 'SET decision = :decision, #sections.#scoring.#data.decision = :decision, updatedAt = :now',
        ExpressionAttributeNames: {
          '#sections': 'sections',
          '#scoring': 'scoring',
          '#data': 'data',
        },
        ExpressionAttributeValues: {
          ':decision': decision,
          ':now': new Date().toISOString(),
        },
      })
    );

    console.log(`Updated brief ${executiveBriefId} decision to ${decision}`);

    return apiResponse(200, {
      ok: true,
      executiveBriefId,
      decision,
      message: `Decision updated to ${decision}`,
    });

  } catch (err) {
    console.error('update-decision error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);