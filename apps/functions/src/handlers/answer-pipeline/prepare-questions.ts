import { Context } from 'aws-lambda';
import { withSentryLambda } from '@/sentry-lambda';
import { getProjectById } from '@/helpers/project';
import { fetchAllProjectQuestions, getClusterThreshold } from '@/helpers/prepare-questions-db';
import { getDocumentsBucket, writeQuestionsToS3 } from '@/helpers/prepare-questions-s3';
import { runClusteringPipeline } from '@/helpers/pipeline-clustering';
import type { PrepareQuestionsEvent, PrepareQuestionsResult } from './types';

// Re-export types for backward compatibility
export type {
  PrepareQuestionsEvent, PrepareQuestionsResult, QuestionForAnswerGeneration, QuestionReference
} from './types';

export const baseHandler = async (
  event: PrepareQuestionsEvent,
  _ctx: Context,
): Promise<PrepareQuestionsResult> => {
  console.log('prepare-questions event:', JSON.stringify(event));

  const { projectId, opportunityId } = event;
  if (!projectId) {
    throw new Error('projectId is required');
  }
  if (!opportunityId) {
    throw new Error('opportunityId is required');
  }

  // Validate project and resolve orgId
  const { orgId } = await getProjectById(projectId) || {};

  if (!orgId) {
    throw new Error(`Project ${projectId} has no orgId`);
  }

  // Step 1: Fetch all questions for this opportunity
  const {
    allQuestions,
    alreadyClusteredQuestions,
    newQuestions
  } = await fetchAllProjectQuestions(projectId, orgId, opportunityId);
  console.log(`Found ${allQuestions.length} total questions for opportunity ${opportunityId}: ${alreadyClusteredQuestions.length} already clustered, ${newQuestions.length} new`);

  const bucket = getDocumentsBucket();

  // Early return for small sets (no clustering needed)
  if (allQuestions.length < 2) {
    const s3Key = await writeQuestionsToS3(projectId, allQuestions);
    return {
      s3Bucket: bucket,
      s3Key,
      totalCount: allQuestions.length,
      projectId,
      orgId,
      clustersCreated: 0,
      mastersCount: 0,
      unclusteredCount: allQuestions.length,
      membersCount: 0
    };
  }

  // Step 2: Cluster (embed → match existing → cluster orphans → sort)
  const clusterThreshold = await getClusterThreshold(orgId);
  const { sortedQuestions, clustersCreated, mastersCount, unclusteredCount, membersCount } =
    await runClusteringPipeline(projectId, orgId, alreadyClusteredQuestions, newQuestions, clusterThreshold);

  // Step 3: Write to S3
  const s3Key = await writeQuestionsToS3(projectId, sortedQuestions);

  return {
    s3Bucket: bucket,
    s3Key,
    totalCount: sortedQuestions.length,
    projectId,
    orgId,
    clustersCreated,
    mastersCount,
    unclusteredCount,
    membersCount
  };
};

export const handler = withSentryLambda(baseHandler);