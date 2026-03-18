import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import type { SimilarQuestion } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { apiResponse, getOrgId } from '@/helpers/api';
import { SIMILAR_THRESHOLD, MAX_SIMILAR_QUESTIONS } from '@/constants/clustering';
import { getOrganizationById } from '@/helpers/org';
import {
  getQuestionById,
  findSimilarInPinecone,
  enrichSimilarMatches,
} from '@/helpers/clustering';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { projectId, questionId } = event.pathParameters ?? {};

  if (!projectId || !questionId) {
    return apiResponse(400, { message: 'Missing projectId or questionId' });
  }

  const { threshold: thresholdParam, limit: limitParam, opportunityId = '', fileId = '' } = event.queryStringParameters ?? {};

  const threshold = thresholdParam ? Math.max(0, Math.min(1, Number(thresholdParam))) : SIMILAR_THRESHOLD;
  const limit = limitParam ? Math.max(1, Math.min(50, Number(limitParam))) : MAX_SIMILAR_QUESTIONS;

  const question = await getQuestionById(projectId, opportunityId, fileId, questionId);
  if (!question?.question) {
    return apiResponse(404, { message: 'Question not found' });
  }

  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { message: 'Organization ID is required (pass via orgId query param or header)' });
  }

  // Use org-level threshold if not explicitly passed
  let effectiveThreshold = threshold;
  if (!thresholdParam) {
    try {
      const org = await getOrganizationById(orgId);
      if (org?.similarThreshold != null && typeof org.similarThreshold === 'number') {
        effectiveThreshold = org.similarThreshold;
      }
    } catch {
      // Fall back to default threshold
    }
  }

  const similarMatches = await findSimilarInPinecone(orgId, projectId, question.question, questionId, effectiveThreshold, limit);

  // Batch-enrich all matches instead of N+1 individual queries
  const enrichedResults = await enrichSimilarMatches(
    similarMatches,
    projectId,
    opportunityId,
    fileId,
    question.clusterId,
  );

  const similarQuestions: SimilarQuestion[] = enrichedResults;

  setAuditContext(event, {
    action: 'SIMILAR_QUESTIONS_SEARCHED',
    resource: 'question',
    resourceId: questionId,
    orgId,
    changes: {
      after: { projectId, resultsCount: similarQuestions.length, threshold: effectiveThreshold },
    },
  });

  return apiResponse(200, { questionId, questionText: question.question, similarQuestions, threshold: effectiveThreshold, limit });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
