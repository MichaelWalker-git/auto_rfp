import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { ApplyClusterAnswerRequestSchema, type ApplyClusterAnswerResponse } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { updateItem } from '@/helpers/db';
import { apiResponse } from '@/helpers/api';
import { getAnswerForQuestion } from '@/helpers/answer';
import { QUESTION_PK } from '@/constants/question';
import { nowIso } from '@/helpers/date';
import { saveAnswer } from '@/handlers/answer/save-answer';
import { buildQuestionSK } from '@/helpers/question';

/**
 * Update question's linkedToMasterQuestionId field using the correct SK pattern.
 * SK: {projectId}#{opportunityId}#{fileId}#{questionId}
 */
const updateQuestionLinkage = async (
  projectId: string,
  opportunityId: string,
  fileId: string,
  questionId: string,
  linkedToMasterQuestionId: string,
): Promise<void> => {
  const sk = buildQuestionSK(projectId, opportunityId, fileId, questionId);
  await updateItem(
    QUESTION_PK,
    sk,
    { linkedToMasterQuestionId, updatedAt: nowIso() },
    { condition: 'attribute_exists(#pk)', conditionNames: { '#pk': 'partition_key' } },
  );
};

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  const { success, data, error } = ApplyClusterAnswerRequestSchema.safeParse(JSON.parse(event.body));
  if (!success) return apiResponse(400, { message: 'Validation failed', issues: error.issues });

  const { orgId, projectId, opportunityId, questionFileId, sourceQuestionId, targetQuestionIds, customText } = data;
  const fileId = questionFileId ?? '';

  const sourceAnswer = await getAnswerForQuestion(projectId, opportunityId, fileId, sourceQuestionId);
  if (!sourceAnswer?.text) {
    return apiResponse(404, { message: 'Source question has no answer to apply' });
  }

  const answerText = customText || sourceAnswer.text;
  const applied: string[] = [];
  const failed: Array<{ questionId: string; reason: string }> = [];

  // Separate self-references from valid targets
  const selfRefs = targetQuestionIds.filter((id) => id === sourceQuestionId);
  const validTargets = targetQuestionIds.filter((id) => id !== sourceQuestionId);

  for (const id of selfRefs) {
    failed.push({ questionId: id, reason: 'Cannot apply answer to itself' });
  }

  // Apply answers in parallel for better performance
  const results = await Promise.allSettled(
    validTargets.map(async (targetQuestionId) => {
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

      await updateQuestionLinkage(projectId, opportunityId, fileId, targetQuestionId, sourceQuestionId);

      return targetQuestionId;
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      applied.push(result.value);
    } else {
      const err = result.reason;
      failed.push({
        questionId: '(unknown)',
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  setAuditContext(event, {
    action: 'CLUSTER_ANSWER_APPLIED',
    resource: 'answer',
    resourceId: sourceQuestionId,
    orgId: orgId ?? undefined,
    changes: {
      after: { projectId, opportunityId, applied: applied.length, failed: failed.length },
    },
  });

  const response: ApplyClusterAnswerResponse = { sourceQuestionId, applied, failed };
  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
