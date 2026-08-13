import { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { CreateQuestionFileRequestSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { createQuestionFile } from '@/helpers/questionFile';
import { markSolutionPlanStaleSafe } from '@/helpers/solution-plan';
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

  const { success, data, error } = CreateQuestionFileRequestSchema.safeParse(JSON.parse(event.body));

  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const created = await createQuestionFile(data);

  // Staleness trigger (T13): a new solicitation document changes an input a
  // READY Solution Plan may have been built from — the helper no-ops otherwise
  // (ADR-3). Best-effort — never fails the upload.
  await markSolutionPlanStaleSafe(
    { orgId: data.orgId, projectId: data.projectId, opportunityId: data.oppId },
    `A new solicitation document ("${data.originalFileName}") was uploaded.`,
  );

  setAuditContext(event, {
    action: 'QUESTION_FILE_CREATED',
    resource: 'question_file',
    resourceId: created.questionFileId,
    orgId: data.orgId,
    changes: {
      after: {
        projectId: data.projectId,
        oppId: data.oppId,
        originalFileName: data.originalFileName,
        mimeType: data.mimeType,
      },
    },
  });

  return apiResponse(201, created);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
