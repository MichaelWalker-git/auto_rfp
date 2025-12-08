import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ANSWER_PK } from '../constants/answer';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME env var is missing');
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const projectId = event.pathParameters?.id;
    if (!projectId) {
      return apiResponse(400, { message: 'Missing projectId' });
    }

    const answers = await loadAnswers(projectId);
    const byQuestion = groupAnswersByQuestion(answers);

    return apiResponse(200, byQuestion);
  } catch (err) {
    console.error('get-answers error', err);
    return apiResponse(500, {
      message: 'Internal error',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
};

// ---------- LOAD ANSWERS FROM DYNAMODB ----------

async function loadAnswers(projectId: string): Promise<any[]> {
  let items: any[] = [];
  let LastKey: any | undefined;

  const prefix = `${projectId}#`;

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
        ExclusiveStartKey: LastKey,
      }),
    );

    if (res.Items) items.push(...res.Items);
    LastKey = res.LastEvaluatedKey;
  } while (LastKey);

  return items;
}

// ---------- GROUP BY questionId & PICK LATEST ----------

/**
 * Result shape: {
 *   [questionId: string]: {
 *     text: string;
 *     source?: string | null;
 *     id?: string;
 *     organizationId?: string | null;
 *     createdAt?: string;
 *     updatedAt?: string;
 *   }
 * }
 */
function groupAnswersByQuestion(flatAnswers: any[]) {
  const map: Record<string, any> = {};

  for (const item of flatAnswers) {
    const questionId = item.questionId;
    if (!questionId) continue;

    const current = map[questionId];

    const candidate = {
      id: item.id,
      questionId: item.questionId,
      projectId: item.projectId,
      organizationId: item.organizationId ?? null,
      text: item.text,
      source: item.source ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };

    if (!current) {
      map[questionId] = candidate;
      continue;
    }

    // pick the latest by updatedAt, then createdAt
    const curTime = new Date(current.updatedAt || current.createdAt || 0).getTime();
    const candTime = new Date(candidate.updatedAt || candidate.createdAt || 0).getTime();

    if (candTime > curTime) {
      map[questionId] = candidate;
    }
  }

  return map;
}
