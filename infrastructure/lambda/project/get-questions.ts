import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/organization';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is missing');

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const projectId = event.pathParameters?.id;
    if (!projectId) {
      return apiResponse(400, { message: 'Missing projectId' });
    }

    const flat = await loadQuestions(projectId);
    const grouped = groupQuestions(flat);

    return apiResponse(200, { sections: grouped });
  } catch (err) {
    console.error('getProjectQuestions error', err);
    return apiResponse(500, {
      message: 'Internal error',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
};

// ---------- LOAD FROM DYNAMODB ----------

async function loadQuestions(projectId: string) {
  let items: any[] = [];
  let LastKey;

  const prefix = `${projectId}#`;

  do {
    const res: any = await docClient.send(
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
    LastKey = res.LastEvaluatedKey;
  } while (LastKey);

  return items;
}

// ---------- GROUP INTO FE SHAPE ----------

function groupQuestions(flat: any[]) {
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

    sectionsMap.get(secId).questions.push({
      id: item.questionId,
      question: item.questionText,
      answer: item.answer ?? null, // optional future use
    });
  }

  return Array.from(sectionsMap.values());
}
