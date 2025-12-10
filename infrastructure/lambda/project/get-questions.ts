import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/organization';
import { ANSWER_PK } from '../constants/answer';
import { withSentryLambda } from '../sentry-lambda';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is missing');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const projectId = event.pathParameters?.id;
    if (!projectId) {
      return apiResponse(400, { message: 'Missing projectId' });
    }

    const flatQuestions = await loadQuestions(projectId);
    const grouped = await groupQuestions(projectId, flatQuestions);

    return apiResponse(200, { sections: grouped });
  } catch (err) {
    console.error('getProjectQuestions error', err);
    return apiResponse(500, {
      message: 'Internal error',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
};

// ---------- LOAD QUESTIONS FROM DYNAMODB ----------
async function loadQuestions(projectId: string) {
  let items: any[] = [];
  let LastKey: Record<string, any> | undefined;

  const prefix = `${projectId}#`;

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
          ':pk': QUESTION_PK,
          ':prefix': prefix,
        },
        ExclusiveStartKey: LastKey,
      }),
    );

    if (res.Items) items.push(...res.Items);
    LastKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (LastKey);

  return items;
}

// ---------- GET SINGLE ANSWER FOR QUESTION ----------
// ANSWER PK = ANSWER_PK
// SK = `${projectId}#${questionId}#${answerId}`
// and there is at most one item per question → use Limit: 1
async function getAnswer(projectId: string, questionId: string) {
  const prefix = `${projectId}#${questionId}#`;

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
      Limit: 1,
    }),
  );

  if (!res.Items || res.Items.length === 0) {
    return null;
  }

  return res.Items[0];
}

// ---------- GROUP INTO FE SHAPE ----------
async function groupQuestions(
  projectId: string,
  flat: any[],
) {
  const sectionsMap = new Map<string, any>();

  for (const item of flat) {
    const secId = item.sectionId;
    if (!sectionsMap.has(secId)) {
      sectionsMap.set(secId, {
        id: secId,
        title: item.sectionTitle,
        description: item.sectionDescription ?? null,
        questions: [],
      });
    }

    const qId = item.questionId as string;
    const answerItem = await getAnswer(projectId, qId);

    sectionsMap.get(secId).questions.push({
      id: qId,
      question: item.questionText,
      answer: answerItem?.text ?? null,
    });
  }

  return Array.from(sectionsMap.values());
}

export const handler = withSentryLambda(baseHandler);