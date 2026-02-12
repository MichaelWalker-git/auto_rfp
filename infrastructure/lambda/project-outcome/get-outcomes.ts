import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_OUTCOME_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import type { DBProjectOutcome } from '../types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * GET /project-outcome/get-outcomes?orgId=X&projectId=Y
 * 
 * Returns all outcomes for a project (across all opportunities).
 * Used by the dashboard to show win/loss statistics.
 */
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, projectId } = event.queryStringParameters || {};

    if (!orgId) {
      return apiResponse(400, {
        message: 'Missing required query parameter: orgId',
      });
    }

    if (!projectId) {
      return apiResponse(400, {
        message: 'Missing required query parameter: projectId',
      });
    }

    const outcomes = await listProjectOutcomes(orgId, projectId);
    
    // Calculate statistics
    const stats = calculateOutcomeStats(outcomes);

    return apiResponse(200, { 
      outcomes, 
      count: outcomes.length,
      stats,
    });
  } catch (err: unknown) {
    console.error('Error in getOutcomes handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

async function listProjectOutcomes(
  orgId: string,
  projectId: string,
): Promise<DBProjectOutcome[]> {
  const skPrefix = `${orgId}#${projectId}`;

  const cmd = new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
    ExpressionAttributeValues: {
      ':pk': PROJECT_OUTCOME_PK,
      ':skPrefix': skPrefix,
    },
    Limit: 200, // Increase limit for projects with many opportunities
  });

  const result = await docClient.send(cmd);
  return (result.Items ?? []) as DBProjectOutcome[];
}

interface OutcomeStats {
  won: number;
  lost: number;
  pending: number;
  noBid: number;
  withdrawn: number;
  total: number;
  winRate: number;
  totalContractValue: number;
}

function calculateOutcomeStats(outcomes: DBProjectOutcome[]): OutcomeStats {
  const stats: OutcomeStats = {
    won: 0,
    lost: 0,
    pending: 0,
    noBid: 0,
    withdrawn: 0,
    total: outcomes.length,
    winRate: 0,
    totalContractValue: 0,
  };

  for (const outcome of outcomes) {
    switch (outcome.status) {
      case 'WON':
        stats.won++;
        if (outcome.winData?.contractValue) {
          stats.totalContractValue += outcome.winData.contractValue;
        }
        break;
      case 'LOST':
        stats.lost++;
        break;
      case 'PENDING':
        stats.pending++;
        break;
      case 'NO_BID':
        stats.noBid++;
        break;
      case 'WITHDRAWN':
        stats.withdrawn++;
        break;
    }
  }

  // Calculate win rate (only counting decided outcomes: won + lost)
  const decidedCount = stats.won + stats.lost;
  stats.winRate = decidedCount > 0 ? Math.round((stats.won / decidedCount) * 100) : 0;

  return stats;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware()),
);