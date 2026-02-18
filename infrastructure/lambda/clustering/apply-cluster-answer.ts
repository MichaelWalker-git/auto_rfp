import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApplyClusterAnswerRequest, ApplyClusterAnswerResponse } from '@auto-rfp/shared';
import { withSentryLambda } from '../sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { apiResponse } from '../helpers/api';
import { getAnswerForQuestion } from '../helpers/answer';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/question';
import { nowIso } from '../helpers/date';
import { saveAnswer } from '../answer/save-answer';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Update question's linkedToMasterQuestionId field
 */
async function updateQuestionLinkage(
  projectId: string,
  questionId: string,
  linkedToMasterQuestionId: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_PK,
        [SK_NAME]: `${projectId}#${questionId}`,
      },
      UpdateExpression: 'SET linkedToMasterQuestionId = :linked, updatedAt = :now',
      ExpressionAttributeValues: {
        ':linked': linkedToMasterQuestionId,
        ':now': nowIso(),
      },
    })
  );
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const body: ApplyClusterAnswerRequest = JSON.parse(event.body || '{}');
    
    const { projectId, sourceQuestionId, targetQuestionIds, customText } = body;
    
    if (!projectId) {
      return apiResponse(400, { message: 'Missing projectId' });
    }
    
    if (!sourceQuestionId) {
      return apiResponse(400, { message: 'Missing sourceQuestionId' });
    }
    
    if (!targetQuestionIds || targetQuestionIds.length === 0) {
      return apiResponse(400, { message: 'Missing or empty targetQuestionIds' });
    }
    
    const sourceAnswer = await getAnswerForQuestion(projectId, sourceQuestionId);
    
    if (!sourceAnswer || !sourceAnswer.text) {
      return apiResponse(404, { message: 'Source question has no answer to apply' });
    }
    
    // Use custom text if provided, otherwise use source answer
    const answerText = customText || sourceAnswer.text;
    
    const applied: string[] = [];
    const failed: Array<{ questionId: string; reason: string }> = [];
    
    for (const targetQuestionId of targetQuestionIds) {
      try {
        // Skip if trying to apply to self
        if (targetQuestionId === sourceQuestionId) {
          failed.push({ questionId: targetQuestionId, reason: 'Cannot apply answer to itself' });
          continue;
        }
        
        await saveAnswer({
          questionId: targetQuestionId,
          projectId,
          text: answerText,
          confidence: sourceAnswer.confidence,
          confidenceBreakdown: sourceAnswer.confidenceBreakdown,
          confidenceBand: sourceAnswer.confidenceBand,
          sources: sourceAnswer.sources,
          linkedToMasterQuestionId: sourceQuestionId,
        });
        
        await updateQuestionLinkage(projectId, targetQuestionId, sourceQuestionId);
        
        applied.push(targetQuestionId);
      } catch (err) {
        console.error(`Failed to apply answer to ${targetQuestionId}:`, err);
        failed.push({
          questionId: targetQuestionId,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    
    const response: ApplyClusterAnswerResponse = {
      sourceQuestionId,
      applied,
      failed,
    };
    
    return apiResponse(200, response);
  } catch (err) {
    console.error('apply-cluster-answer error:', err);
    return apiResponse(500, {
      message: 'Failed to apply cluster answer',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:edit'))
    .use(httpErrorMiddleware())
);