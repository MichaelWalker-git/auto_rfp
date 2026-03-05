import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { ReextractAllQuestionsSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { reextractAllQuestions } from '@/helpers/questionFile';
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

  const { success, data, error } = ReextractAllQuestionsSchema.safeParse(JSON.parse(event.body));
  if (!success) return apiResponse(400, { message: 'Validation failed', issues: error.issues });

  const result = await reextractAllQuestions(data);

  setAuditContext(event, {
    action: 'QUESTION_FILE_REEXTRACT_ALL',
    resource: 'opportunity',
    resourceId: data.oppId,
    changes: {
      after: {
        projectId: data.projectId,
        oppId: data.oppId,
        questionsDeleted: result.questionsDeleted,
        answersDeleted: result.answersDeleted,
        clustersDeleted: result.clustersDeleted,
        filesProcessed: result.filesProcessed,
      },
    },
  });

  return apiResponse(202, {
    ok: true,
    message: `Re-extraction started for all ${result.filesProcessed} file(s). ${result.questionsDeleted} question(s), ${result.answersDeleted} answer(s), and ${result.clustersDeleted} cluster(s) deleted.`,
    ...result,
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
