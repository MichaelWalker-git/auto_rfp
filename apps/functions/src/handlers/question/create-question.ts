import { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { CreateQuestionsSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { createQuestions } from '@/helpers/question';
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
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  const { success, data, error } = CreateQuestionsSchema.safeParse(JSON.parse(event.body));

  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const questions = await createQuestions(data);

  setAuditContext(event, {
    action: 'QUESTION_CREATED',
    resource: 'question',
    resourceId: data.projectId,
    orgId: data.orgId,
    changes: {
      after: {
        projectId: data.projectId,
        opportunityId: data.opportunityId,
        questionFileId: data.questionFileId,
        count: questions.length,
      },
    },
  });

  return apiResponse(201, {
    message: `${questions.length} questions created`,
    projectId: data.projectId,
    questions,
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
