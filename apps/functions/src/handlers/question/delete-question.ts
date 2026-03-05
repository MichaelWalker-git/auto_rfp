import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { deleteQuestion } from '@/helpers/question';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';


export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { projectId, opportunityId, questionId, fileId, orgId } = event.queryStringParameters ?? {};

  if (!projectId || !opportunityId || !questionId) {
    return apiResponse(400, { message: 'projectId, opportunityId and questionId are required' });
  }

  const result = await deleteQuestion(projectId, opportunityId, fileId ?? '', questionId, orgId);

  if (!result) {
    return apiResponse(404, { message: 'Question not found', projectId, questionId });
  }

  setAuditContext(event, {
    action: 'QUESTION_DELETED',
    resource: 'question',
    resourceId: questionId,
    orgId,
    changes: {
      before: { projectId, opportunityId, questionId, fileId },
    },
  });

  return apiResponse(200, {
    ok: true,
    projectId,
    opportunityId,
    questionId,
    ...result,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:delete'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
