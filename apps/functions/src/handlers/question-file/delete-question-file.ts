import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { deleteQuestionFileWithCascade } from '@/helpers/questionFile';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { projectId, questionFileId, oppId } = event.queryStringParameters ?? {};

  if (!projectId) return apiResponse(400, { message: 'projectId query param is required' });
  if (!questionFileId) return apiResponse(400, { message: 'questionFileId query param is required' });
  if (!oppId) return apiResponse(400, { message: 'oppId query param is required' });

  const result = await deleteQuestionFileWithCascade(projectId, oppId, questionFileId);

  if (!result) {
    return apiResponse(404, { message: 'Question file not found' });
  }

  setAuditContext(event, {
    action: 'QUESTION_FILE_DELETED',
    resource: 'question_file',
    resourceId: questionFileId,
    changes: {
      before: { projectId, oppId, questionFileId },
    },
  });

  return apiResponse(200, {
    success: true,
    deleted: {
      projectId,
      questionFileId: result.questionFileId,
      sk: result.sk,
    },
    questions: {
      deleted: result.questionsDeleted,
    },
    s3: result.s3,
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
