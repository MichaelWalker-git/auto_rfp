import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { listQuestionFilesByOpportunity } from '@/helpers/questionFile';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { AnswerItem, GroupedSection, QuestionItem } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId } = event.pathParameters || {};
    if (!projectId) {
      return apiResponse(400, { message: 'Missing projectId' });
    }

    const opportunityId = event.queryStringParameters?.opportunityId;
    if (!opportunityId) {
      return apiResponse(400, { message: 'opportunityId query parameter is required' });
    }

    // Run both queries in parallel — 2 DB queries total instead of N+1
    const [flatQuestions, allAnswers] = await Promise.all([
      loadQuestions(projectId, opportunityId),
      loadAnswers(projectId),
    ]);

    // Only include answers for the returned questions (answers don't store opportunityId)
    const answersMap = filterAnswersByQuestions(allAnswers, flatQuestions);
    const sections = groupQuestions(flatQuestions, answersMap);

    console.log('[get-questions] Response data:', {
      sectionsCount: sections.length,
      answersCount: Object.keys(answersMap).length,
      opportunityId,
      totalQuestions: flatQuestions.length,
    });

    return apiResponse(200, { sections, answers: answersMap });
  } catch (err) {
    console.error('getProjectQuestions error', err);
    return apiResponse(500, {
      message: 'Internal error',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
};

/**
 * Load questions for a project filtered by opportunityId.
 * Excludes questions from non-PROCESSED question files (orphans from
 * cancelled/failed pipelines).
 */
const loadQuestions = async (projectId: string, opportunityId: string): Promise<QuestionItem[]> => {
  const items: QuestionItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  const prefix = `${projectId}#`;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        FilterExpression: '#oppId = :oppId',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
          '#oppId': 'opportunityId',
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_PK,
          ':prefix': prefix,
          ':oppId': opportunityId,
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    if (res.Items) items.push(...(res.Items as QuestionItem[]));
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  // Filter out questions from non-PROCESSED files (orphans from cancelled/failed pipelines)
  const { items: questionFiles } = await listQuestionFilesByOpportunity({ projectId, oppId: opportunityId });
  const processedFileIds = new Set(
    (questionFiles as Array<{ questionFileId: string; status: string }>)
      .filter((qf) => qf.status === 'PROCESSED')
      .map((qf) => qf.questionFileId),
  );

  return items.filter((q) => {
    if (!q.questionFileId || q.questionFileId === 'manual') return true;
    return processedFileIds.has(q.questionFileId);
  });
};

/**
 * Filter answers map to only include answers for the given questions.
 * Answers don't store opportunityId — they link to questions via questionId.
 */
const filterAnswersByQuestions = (
  allAnswers: Record<string, AnswerItem>,
  questions: QuestionItem[],
): Record<string, AnswerItem> => {
  const questionIds = new Set(questions.map((q: QuestionItem) => q.questionId));
  const filtered: Record<string, AnswerItem> = {};
  for (const [qId, answer] of Object.entries(allAnswers)) {
    if (questionIds.has(qId)) {
      filtered[qId] = answer;
    }
  }
  return filtered;
};

/**
 * Load all answers for a project in a single query, grouped by questionId (latest wins).
 * Source textContent is stripped to reduce payload size.
 */
const loadAnswers = async (projectId: string): Promise<Record<string, AnswerItem>> => {
  const grouped: Record<string, AnswerItem> = {};
  let lastKey: Record<string, unknown> | undefined;
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
          ':pk': ANSWER_PK,
          ':prefix': prefix,
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    if (res.Items) {
      for (const item of res.Items as AnswerItem[]) {
        const questionId = item.questionId;
        if (!questionId) continue;

        const current = grouped[questionId];
        if (!current) {
          grouped[questionId] = stripSourceContent(item);
        } else {
          // Keep the most recent answer
          const curTime = new Date(current.updatedAt || current.createdAt || '0').getTime();
          const candTime = new Date(item.updatedAt || item.createdAt || '0').getTime();
          if (candTime > curTime) {
            grouped[questionId] = stripSourceContent(item);
          }
        }
      }
    }

    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return grouped;
};

/**
 * Strip textContent from sources to reduce payload size.
 * NOTE: Disabled — textContent is already truncated to ~600 chars at generation
 * time, so the payload increase is modest (~3-6KB per answer), and the frontend
 * needs it to display source details in the SourceDetailsDialog.
 */
const stripSourceContent = (answer: AnswerItem): AnswerItem => answer;

/**
 * Group flat questions into sections, attaching inline answer text from the pre-fetched map.
 * This is now synchronous — no per-question DB calls.
 */
const groupQuestions = (
  flat: QuestionItem[],
  answersMap: Record<string, AnswerItem>,
): GroupedSection[] => {
  const sectionsMap = new Map<string, GroupedSection>();

  for (const item of flat) {
    const secId = item.sectionId;
    if (!sectionsMap.has(secId)) {
      sectionsMap.set(secId, {
        id: secId,
        title: item.sectionTitle ?? '',
        description: item.sectionDescription ?? null,
        questions: [],
      });
    }

    const qId = item.questionId;
    const answerItem = answersMap[qId];

    sectionsMap.get(secId)!.questions.push({
      id: qId,
      question: item.question ?? '',
      answer: answerItem?.text ?? null,
      opportunityId: item.opportunityId ?? undefined,
      questionFileId: item.questionFileId ?? undefined,
      clusterId: item.clusterId,
      isClusterMaster: item.isClusterMaster,
      similarityToMaster: item.similarityToMaster,
      linkedToMasterQuestionId: item.linkedToMasterQuestionId,
    });
  }

  return Array.from(sectionsMap.values());
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read'))
    .use(httpErrorMiddleware())
);
