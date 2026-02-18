import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware } from '@/middleware/rbac-middleware';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { buildQuestionSK } from '@/helpers/question';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * POST /question/create-question
 * Creates manual questions for a project.
 * Body: { projectId, sections: [{ title, questions: [{ question }] }] }
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const orgId = getOrgId(event);
  const body = JSON.parse(event.body || '{}');
  const { projectId, sections } = body;

  if (!projectId || !orgId) {
    return apiResponse(400, { error: 'projectId and orgId are required' });
  }

  if (!sections || !Array.isArray(sections) || sections.length === 0) {
    return apiResponse(400, { error: 'sections array is required' });
  }

  const now = new Date().toISOString();
  const createdQuestions: Array<{ questionId: string; question: string; sectionTitle: string }> = [];

  for (const section of sections) {
    const sectionId = section.id || uuidv4();
    const sectionTitle = section.title || 'Untitled Section';

    for (const q of section.questions || []) {
      if (!q.question?.trim()) continue;

      const questionId = uuidv4();
      const sk = buildQuestionSK(projectId, questionId);

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            [PK_NAME]: QUESTION_PK,
            [SK_NAME]: sk,
            projectId,
            questionFileId: 'manual',
            questionId,
            question: q.question.trim(),
            sectionId,
            sectionTitle,
            sectionDescription: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );

      createdQuestions.push({ questionId, question: q.question.trim(), sectionTitle });
    }
  }

  return apiResponse(201, {
    message: `${createdQuestions.length} questions created`,
    projectId,
    questions: createdQuestions,
  });
}

export const handler = middy(withSentryLambda(baseHandler))
  .use(httpErrorMiddleware())
  .use(authContextMiddleware())
  .use(orgMembershipMiddleware());
