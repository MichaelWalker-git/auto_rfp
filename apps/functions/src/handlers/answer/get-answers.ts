import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { QueryCommand, } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { ANSWER_PK } from '@/constants/answer';
import { withSentryLambda } from '@/sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { AnswerItem, AnswerSource } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// Default page size - balance between payload size and number of requests
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// Maximum response size threshold (5MB to leave buffer for Lambda's 6MB limit)
const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;

const safeJsonParse = <T>(raw: string): T | undefined => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

function encodeNextToken(lastKey?: Record<string, any> | null): string | null {
  if (!lastKey) return null;
  return Buffer.from(JSON.stringify(lastKey), 'utf-8').toString('base64url');
}

function decodeNextToken(token?: string): Record<string, any> | undefined {
  if (!token) return undefined;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    return safeJsonParse<Record<string, any>>(decoded);
  } catch {
    return undefined;
  }
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

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const { id: projectId } = event.pathParameters || {};

    if (!projectId) {
      return apiResponse(400, { message: 'Missing projectId' });
    }

    const { 
      limit: queryLimit, 
      nextToken,
      includeSourceContent 
    } = event.queryStringParameters ?? {};

    // Parse and validate limit
    const limitRaw = queryLimit ? Number(queryLimit) : DEFAULT_LIMIT;
    const limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw)))
      : DEFAULT_LIMIT;

    // Decode pagination token
    const exclusiveStartKey = decodeNextToken(nextToken);
    if (nextToken && !exclusiveStartKey) {
      return apiResponse(400, { message: 'Invalid nextToken' });
    }

    // Whether to include full source content (default: false to reduce payload)
    const shouldIncludeSourceContent = includeSourceContent === 'true';

    const result = await loadAnswersPaginated(
      projectId, 
      limit, 
      exclusiveStartKey,
      shouldIncludeSourceContent
    );

    return apiResponse(200, result);
  } catch (err) {
    console.error('get-answers error', err);
    return apiResponse(500, {
      message: 'Internal error',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
};

interface LoadAnswersResult {
  items: Record<string, AnswerItem>;
  nextToken: string | null;
}

async function loadAnswersPaginated(
  projectId: string,
  limit: number,
  exclusiveStartKey?: Record<string, any>,
  includeSourceContent: boolean = false
): Promise<LoadAnswersResult> {
  const prefix = `${projectId}#`;
  const groupedAnswers: Record<string, AnswerItem> = {};
  let lastEvaluatedKey: Record<string, any> | undefined = exclusiveStartKey;
  let processedCount = 0;
  let currentResponseSize = 0;

  // We need to fetch more items than the limit because we're grouping by questionId
  // and only keeping the latest answer per question
  const fetchLimit = Math.min(limit * 3, 1000);

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression:
          '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': ANSWER_PK,
          ':prefix': prefix,
        },
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: fetchLimit,
      }),
    );

    if (res.Items) {
      for (const item of res.Items as AnswerItem[]) {
        const questionId = item.questionId;
        if (!questionId) continue;

        // Process the answer (strip source content if needed)
        const processedAnswer = includeSourceContent ? item : stripSourceContent(item);

        const current = groupedAnswers[questionId];

        if (!current) {
          // Estimate size of this answer
          const answerSize = JSON.stringify(processedAnswer).length;
          
          // Check if adding this answer would exceed size limit
          if (currentResponseSize + answerSize > MAX_RESPONSE_SIZE_BYTES) {
            // Stop processing and return what we have
            return {
              items: groupedAnswers,
              nextToken: encodeNextToken(lastEvaluatedKey),
            };
          }

          groupedAnswers[questionId] = processedAnswer;
          currentResponseSize += answerSize;
          processedCount++;
        } else {
          // Keep the most recent answer
          const curTime = new Date(current.updatedAt || current.createdAt || 0).getTime();
          const candTime = new Date(item.updatedAt || item.createdAt || 0).getTime();
          if (candTime > curTime) {
            // Update size estimate
            const oldSize = JSON.stringify(current).length;
            const newSize = JSON.stringify(processedAnswer).length;
            currentResponseSize = currentResponseSize - oldSize + newSize;
            
            groupedAnswers[questionId] = processedAnswer;
          }
        }

        // Check if we've reached the requested limit
        if (processedCount >= limit) {
          return {
            items: groupedAnswers,
            nextToken: encodeNextToken(res.LastEvaluatedKey),
          };
        }
      }
    }

    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return {
    items: groupedAnswers,
    nextToken: null,
  };
}



export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:read'))
    .use(httpErrorMiddleware())
);