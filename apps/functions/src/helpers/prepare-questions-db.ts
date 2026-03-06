/**
 * DynamoDB query helpers for the prepare-questions pipeline.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { CLUSTER_THRESHOLD } from '@/constants/clustering';
import { getOrganizationById } from '@/handlers/organization/get-organization-by-id';
import type { QuestionForAnswerGeneration, FetchedQuestions } from '@/handlers/answer-pipeline/types';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Fetch all questions for a project+opportunity from DynamoDB, separating
 * already-clustered questions from new (unclustered) ones.
 *
 * SK pattern: {projectId}#{opportunityId}#{fileId}#{questionId}
 */
export const fetchAllProjectQuestions = async (
  projectId: string,
  orgId: string,
  opportunityId: string,
): Promise<FetchedQuestions> => {
  const allQuestions: QuestionForAnswerGeneration[] = [];
  const alreadyClusteredQuestions: QuestionForAnswerGeneration[] = [];
  const newQuestions: QuestionForAnswerGeneration[] = [];

  let lastKey: Record<string, unknown> | undefined;
  const prefix = `${projectId}#${opportunityId}#`;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pk': QUESTION_PK, ':prefix': prefix },
        ExclusiveStartKey: lastKey,
        ConsistentRead: true,
      }),
    );

    if (res.Items) {
      for (const item of res.Items) {
        const questionId = item.questionId as string;
        const questionText = item.question as string;

        if (!questionId || !questionText) continue;

        const question: QuestionForAnswerGeneration = {
          questionId,
          projectId,
          orgId,
          questionText,
          sectionId: item.sectionId as string | undefined,
          sectionTitle: item.sectionTitle as string | undefined,
          opportunityId: item.opportunityId as string | undefined,
          questionFileId: item.questionFileId as string | undefined,
          clusterId: item.clusterId as string | undefined,
          isClusterMaster: item.isClusterMaster as boolean | undefined,
          masterQuestionId: item.linkedToMasterQuestionId as string | undefined,
          similarityToMaster: item.similarityToMaster as number | undefined,
        };

        if (item.clusterId) {
          alreadyClusteredQuestions.push(question);
        } else {
          newQuestions.push(question);
        }

        allQuestions.push(question);
      }
    }

    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return { allQuestions, alreadyClusteredQuestions, newQuestions };
};

/**
 * Load the cluster threshold from org settings, falling back to the default.
 */
export const getClusterThreshold = async (orgId: string): Promise<number> => {
  try {
    const org = await getOrganizationById(orgId);
    if (org?.clusterThreshold != null && typeof org.clusterThreshold === 'number') {
      return org.clusterThreshold;
    }
    console.log(`Org has no clusterThreshold set, using default: ${(CLUSTER_THRESHOLD * 100).toFixed(0)}%`);
  } catch (err) {
    console.warn('Failed to load org settings, using default threshold:', err);
  }
  return CLUSTER_THRESHOLD;
};
