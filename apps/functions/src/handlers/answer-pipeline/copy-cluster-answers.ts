import { Context } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { saveAnswer } from '../answer/save-answer';
import { getAnswerForQuestion } from '../helpers/answer';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_CLUSTER_PK } from '../constants/clustering';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export interface CopyClusterAnswersEvent {
  projectId: string;
}

export interface CopyClusterAnswersResult {
  projectId: string;
  totalClusters: number;
  copiedAnswers: number;
  skippedNoMasterAnswer: number;
  errors: number;
}

/**
 * Copy answers from master questions to all cluster members
 */
export const baseHandler = async (
  event: CopyClusterAnswersEvent,
  _ctx: Context,
): Promise<CopyClusterAnswersResult> => {
  console.log('copy-cluster-answers event:', JSON.stringify(event));

  const { projectId } = event;

  if (!projectId) {
    throw new Error('Missing projectId');
  }

  let totalClusters = 0;
  let copiedAnswers = 0;
  let skippedNoMasterAnswer = 0;
  let errors = 0;

  // Query all clusters for the project
  let lastKey: Record<string, any> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_CLUSTER_PK,
          ':prefix': `${projectId}#`,
        },
        ExclusiveStartKey: lastKey,
      })
    );

    if (result.Items) {
      for (const cluster of result.Items) {
        totalClusters++;
        
        const masterQuestionId = cluster.masterQuestionId as string;
        const members = cluster.members as Array<{ questionId: string; similarity: number }>;
        
        if (!masterQuestionId || !members) {
          console.log(`Cluster ${cluster.clusterId} missing masterQuestionId or members, skipping`);
          continue;
        }
        
        // Get master's answer
        const masterAnswer = await getAnswerForQuestion(projectId, masterQuestionId);
        
        if (!masterAnswer || !masterAnswer.text) {
          console.log(`Master ${masterQuestionId} has no answer, skipping cluster ${cluster.clusterId}`);
          skippedNoMasterAnswer++;
          continue;
        }
        
        console.log(`Copying master ${masterQuestionId} answer to ${members.length - 1} members in cluster ${cluster.clusterId}`);
        
        // Copy to all non-master members
        for (const member of members) {
          if (member.questionId === masterQuestionId) {
            continue; // Skip the master itself
          }
          
          try {
            // Check if member already has an answer
            const existingAnswer = await getAnswerForQuestion(projectId, member.questionId);
            
            if (existingAnswer && existingAnswer.text) {
              console.log(`Member ${member.questionId} already has answer, skipping`);
              continue;
            }
            
            // Copy master's answer
            const savedAnswer = await saveAnswer({
              questionId: member.questionId,
              projectId,
              text: masterAnswer.text,
              confidence: masterAnswer.confidence,
              confidenceBreakdown: masterAnswer.confidenceBreakdown,
              confidenceBand: masterAnswer.confidenceBand,
              sources: masterAnswer.sources,
              linkedToMasterQuestionId: masterQuestionId,
            });
            
            copiedAnswers++;
            console.log(`Copied answer to ${member.questionId}, savedAnswer id=${savedAnswer?.id}`);
          } catch (err) {
            console.error(`Failed to copy answer to ${member.questionId}:`, err);
            errors++;
          }
        }
      }
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  console.log(`Copy complete: ${totalClusters} clusters, ${copiedAnswers} answers copied, ${skippedNoMasterAnswer} skipped (no master answer), ${errors} errors`);

  return {
    projectId,
    totalClusters,
    copiedAnswers,
    skippedNoMasterAnswer,
    errors,
  };
};

export const handler = withSentryLambda(baseHandler);