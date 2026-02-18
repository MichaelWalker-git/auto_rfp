import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { ANSWER_PK } from '@/constants/answer';
import { withSentryLambda } from '../../sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { AnswerItem, AnswerSource, getConfidenceBand } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const DEFAULT_THRESHOLD = 70; // Below this = low confidence
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface LowConfidenceAnswerItem extends AnswerItem {
  confidencePct: number;
  confidenceBand: 'high' | 'medium' | 'low';
}

/**
 * Strip textContent from sources to reduce payload size
 */
function stripSourceContent(answer: AnswerItem): AnswerItem {
  if (!answer.sources || answer.sources.length === 0) {
    return answer;
  }

  return {
    ...answer,
    sources: answer.sources.map((source: AnswerSource) => {
      const { textContent, ...rest } = source;
      return rest;
    }),
  };
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { id: projectId } = event.pathParameters || {};

    if (!projectId) {
      return apiResponse(400, { message: 'Missing projectId' });
    }

    const {
      threshold: thresholdParam,
      limit: limitParam,
      band: bandParam,
    } = event.queryStringParameters ?? {};

    // Parse threshold (0-100 scale)
    const threshold = thresholdParam
      ? Math.max(0, Math.min(100, Number(thresholdParam)))
      : DEFAULT_THRESHOLD;

    // Parse limit
    const limitRaw = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
    const limit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw)))
        : DEFAULT_LIMIT;

    // Optional band filter
    const bandFilter = bandParam as 'high' | 'medium' | 'low' | undefined;

    const result = await loadLowConfidenceAnswers(
      projectId,
      threshold,
      limit,
      bandFilter,
    );

    return apiResponse(200, {
      items: result.items,
      count: result.items.length,
      threshold,
      band: bandFilter || null,
    });
  } catch (err) {
    console.error('get-low-confidence-answers error', err);
    return apiResponse(500, {
      message: 'Internal error',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
};

interface LoadLowConfidenceResult {
  items: LowConfidenceAnswerItem[];
}

async function loadLowConfidenceAnswers(
  projectId: string,
  threshold: number,
  limit: number,
  bandFilter?: 'high' | 'medium' | 'low',
): Promise<LoadLowConfidenceResult> {
  const prefix = `${projectId}#`;
  const collected: LowConfidenceAnswerItem[] = [];
  const seenQuestions = new Set<string>();
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': ANSWER_PK,
          ':prefix': prefix,
        },
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 500,
      }),
    );

    if (res.Items) {
      for (const raw of res.Items as AnswerItem[]) {
        const questionId = raw.questionId;
        if (!questionId || seenQuestions.has(questionId)) continue;
        seenQuestions.add(questionId);

        // Convert confidence (0-1) to percentage (0-100)
        const confidenceRaw = raw.confidence ?? 0;
        const confidencePct = Math.round(confidenceRaw * 100);
        const band = raw.confidenceBand || getConfidenceBand(confidencePct);

        // Apply filters
        if (bandFilter && band !== bandFilter) continue;
        if (!bandFilter && confidencePct >= threshold) continue;

        const stripped = stripSourceContent(raw);

        collected.push({
          ...stripped,
          confidencePct,
          confidenceBand: band,
        });

        if (collected.length >= limit) break;
      }
    }

    if (collected.length >= limit) break;
    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  // Sort by confidence ascending (lowest first — most needing review)
  collected.sort((a, b) => a.confidencePct - b.confidencePct);

  return { items: collected };
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:read'))
    .use(httpErrorMiddleware()),
);