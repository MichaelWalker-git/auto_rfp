import { Context } from 'aws-lambda';
import { ConfidenceBreakdown } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';
import { queryBySkPrefix, type DBItem } from '@/helpers/db';
import { QUESTION_PK } from '@/constants/question';
import { generateAnswerForQuestion, GenerateAnswerResult } from '@/handlers/answer/generate-answer';

/**
 * Minimal question reference from Step Function (to avoid 256KB payload limit)
 * Full question data is fetched from DynamoDB
 */
export interface GenerateAnswerPipelineEvent {
  questionId: string;
  projectId: string;
  orgId: string;
  opportunityId: string;
  // Clustering fields from prepare-questions
  clusterId?: string;
  isClusterMaster?: boolean;
  masterQuestionId?: string;
}

export interface GenerateAnswerPipelineResult {
  questionId: string;
  success: boolean;
  error?: string;
  answer?: string;
  confidence?: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: 'high' | 'medium' | 'low';
  found?: boolean;
  fromContentLibrary?: boolean;
  copiedFromMaster?: boolean;
  masterQuestionId?: string;
  skippedForCluster?: boolean;
}

export const baseHandler = async (
  event: GenerateAnswerPipelineEvent,
  _ctx: Context,
): Promise<GenerateAnswerPipelineResult> => {
  console.log('generate-answer-pipeline event:', JSON.stringify(event));

  const { questionId, projectId, orgId, opportunityId, masterQuestionId, isClusterMaster } = event;

  if (!questionId || !projectId || !orgId || !opportunityId) {
    return {
      questionId: questionId || 'unknown',
      success: false,
      error: 'Missing required fields: questionId, projectId, orgId, opportunityId',
    };
  }

  try {
    // If this is a non-master question in a cluster, SKIP - answers will be copied in a separate step
    if (masterQuestionId && !isClusterMaster) {
      console.log(`Question ${questionId} is non-master in cluster, skipping (will copy from master ${masterQuestionId} later)`);
      return {
        questionId,
        success: true,
        skippedForCluster: true,
        masterQuestionId,
      };
    }

    // Fetch full question data from DynamoDB using prefix query
    // SK format: {projectId}#{opportunityId}#{fileId}#{questionId}
    // We query with prefix and filter by questionId since fileId varies
    const skPrefix = `${projectId}#${opportunityId}#`;
    
    type QuestionDBItem = DBItem & { questionId?: string; question?: string };
    const items = await queryBySkPrefix<QuestionDBItem>(QUESTION_PK, skPrefix);
    
    const questionItem = items.find(
      (item) => item.questionId === questionId || item.sort_key?.endsWith(`#${questionId}`)
    );
    
    if (!questionItem) {
      console.error(`Question not found: PK=${QUESTION_PK}, prefix=${skPrefix}, questionId=${questionId}`);
      return {
        questionId,
        success: false,
        error: `Question not found in database`,
      };
    }
    
    const questionText = questionItem.question;
    if (!questionText) {
      return {
        questionId,
        success: false,
        error: 'Question has no text',
      };
    }

    // Extract questionFileId from SK: {projectId}#{opportunityId}#{fileId}#{questionId}
    const skParts = questionItem.sort_key?.split('#') ?? [];
    const questionFileId = skParts[2] ?? '';

    // Generate answer using full answer generation logic
    const result: GenerateAnswerResult = await generateAnswerForQuestion({
      questionId,
      projectId,
      orgId,
      opportunityId,
      questionFileId,
      questionText,
    });

    return {
      questionId: result.questionId,
      success: true,
      answer: result.answer,
      confidence: result.confidence,
      confidenceBreakdown: result.confidenceBreakdown,
      confidenceBand: result.confidenceBand,
      found: result.found,
      fromContentLibrary: result.fromContentLibrary,
      copiedFromMaster: false,
    };
  } catch (err) {
    console.error(`Error generating answer for question ${questionId}:`, err);

    return {
      questionId,
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
};

export const handler = withSentryLambda(baseHandler);