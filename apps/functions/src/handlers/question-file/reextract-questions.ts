import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { ReextractQuestionsSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { reextractQuestions } from '@/helpers/questionFile';
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
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  const { success, data, error } = ReextractQuestionsSchema.safeParse(JSON.parse(event.body));
  if (!success) return apiResponse(400, { message: 'Validation failed', issues: error.issues });

  const result = await reextractQuestions(data);

  if (!result) {
    return apiResponse(404, { message: 'Question file not found' });
  }

  setAuditContext(event, {
    action: 'QUESTION_FILE_CREATED',
    resource: 'question_file',
    resourceId: data.questionFileId,
    changes: {
      after: {
        projectId: data.projectId,
        oppId: data.oppId,
        questionFileId: data.questionFileId,
        deletedCount: result.deletedCount,
      },
    },
  });

  return apiResponse(202, {
    ok: true,
    message: `Re-extraction started. ${result.deletedCount} previous question(s) deleted.`,
    deletedCount: result.deletedCount,
    executionArn: result.executionArn,
    startDate: result.startDate,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
