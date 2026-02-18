import { Context } from 'aws-lambda';
import { ConfidenceBreakdown } from '@auto-rfp/shared';
import { withSentryLambda } from '../sentry-lambda';
import { generateAnswerForQuestion, GenerateAnswerResult } from '../answer/generate-answer';

export interface GenerateAnswerPipelineEvent {
  questionId: string;
  projectId: string;
  orgId: string;
  questionText?: string;
  // Clustering fields from prepare-questions
  clusterId?: string;
  isClusterMaster?: boolean;
  masterQuestionId?: string;
  similarityToMaster?: number;
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

  const { questionId, projectId, orgId, questionText, masterQuestionId, isClusterMaster } = event;

  if (!questionId || !projectId || !orgId) {
    return {
      questionId: questionId || 'unknown',
      success: false,
      error: 'Missing required fields: questionId, projectId, orgId',
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

    // Generate answer using full answer generation logic
    const result: GenerateAnswerResult = await generateAnswerForQuestion({
      questionId,
      projectId,
      orgId,
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