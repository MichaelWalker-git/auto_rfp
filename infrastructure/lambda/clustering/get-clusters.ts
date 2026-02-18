import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { QuestionCluster, GetClustersResponse, ClusterMember } from '@auto-rfp/shared';
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
import { hasAnswer } from '../helpers/answer';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_CLUSTER_PK } from '../constants/clustering';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId } = event.pathParameters || {};
    
    if (!projectId) {
      return apiResponse(400, { message: 'Missing projectId' });
    }
    
    // Query all clusters for the project
    const clusters: QuestionCluster[] = [];
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
        for (const item of result.Items) {
          const cluster = item as QuestionCluster;
          
          // Update hasAnswer status for each member
          const updatedMembers: ClusterMember[] = await Promise.all(
            cluster.members.map(async (member: ClusterMember) => ({
              ...member,
              hasAnswer: await hasAnswer(projectId, member.questionId),
            }))
          );
          
          clusters.push({
            ...cluster,
            members: updatedMembers,
          });
        }
      }
      
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    
    // Sort clusters by question count (largest first)
    clusters.sort((a, b) => b.questionCount - a.questionCount);
    
    const response: GetClustersResponse = {
      projectId,
      clusters,
      totalClusters: clusters.length,
    };
    
    return apiResponse(200, response);
  } catch (err) {
    console.error('get-clusters error:', err);
    return apiResponse(500, {
      message: 'Failed to get clusters',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read'))
    .use(httpErrorMiddleware())
);