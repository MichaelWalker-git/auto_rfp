import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { ClusterMember, GetClustersResponse, QuestionCluster } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { queryAllBySkPrefix } from '@/helpers/db';
import { apiResponse, getOrgId } from '@/helpers/api';
import { batchCheckAnswers } from '@/helpers/clustering';
import { QUESTION_CLUSTER_PK } from '@/constants/clustering';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { projectId } = event.pathParameters ?? {};
  const { opportunityId } = event.queryStringParameters ?? {};

  if (!projectId) return apiResponse(400, { message: 'Missing projectId' });

  const orgId = getOrgId(event);

  // Query all clusters for the project using begins_with SK prefix
  const allItems = await queryAllBySkPrefix<QuestionCluster>(
    QUESTION_CLUSTER_PK,
    `${projectId}#`,
  );

  // Filter clusters by opportunityId if provided
  const filteredItems = allItems.filter((cluster) => {
    if (!opportunityId || opportunityId === 'all') return true;
    if (opportunityId === 'other') return !cluster.opportunityId;
    return cluster.opportunityId === opportunityId;
  });

  // Batch-check answers for all members instead of N+1 individual calls
  // Group by opportunityId+fileId to minimize queries
  const answerSets = new Map<string, Set<string>>();

  const uniqueKeys = new Set<string>();
  for (const cluster of filteredItems) {
    const key = `${cluster.opportunityId ?? ''}|${cluster.questionFileId ?? ''}`;
    uniqueKeys.add(key);
  }

  await Promise.all(
    Array.from(uniqueKeys).map(async (key) => {
      const [oppId, fileId] = key.split('|');
      const answeredIds = await batchCheckAnswers(projectId, oppId ?? '', fileId ?? '');
      answerSets.set(key, answeredIds);
    }),
  );

  const clusters: QuestionCluster[] = filteredItems.map((cluster) => {
    const key = `${cluster.opportunityId ?? ''}|${cluster.questionFileId ?? ''}`;
    const answeredIds = answerSets.get(key) ?? new Set<string>();

    const updatedMembers: ClusterMember[] = cluster.members.map((member: ClusterMember) => ({
      ...member,
      hasAnswer: answeredIds.has(member.questionId),
    }));

    return { ...cluster, members: updatedMembers };
  });

  // Sort clusters by question count (largest first)
  clusters.sort((a, b) => b.questionCount - a.questionCount);

  const response: GetClustersResponse = {
    projectId,
    clusters,
    totalClusters: clusters.length,
  };

  setAuditContext(event, {
    action: 'CLUSTERS_VIEWED',
    resource: 'question',
    resourceId: projectId,
    orgId: orgId ?? undefined,
    changes: {
      after: { projectId, totalClusters: clusters.length },
    },
  });

  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
