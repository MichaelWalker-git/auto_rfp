import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { StartQuestionPipelineSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { getQuestionFileItem, updateQuestionFile } from '@/helpers/questionFile';
import { startPipeline } from '@/helpers/solicitation';
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

  const { success, data, error } = StartQuestionPipelineSchema.safeParse(JSON.parse(event.body));
  if (!success) return apiResponse(400, { message: 'Validation failed', issues: error.issues });

  const { projectId, oppId, questionFileId } = data;

  const qf = await getQuestionFileItem(projectId, oppId, questionFileId);
  if (!qf) return apiResponse(404, { message: 'Question file not found' });

  const { executionArn, startDate } = await startPipeline(
    projectId,
    oppId,
    questionFileId,
    qf.fileKey,
    qf.mimeType,
  );

  await updateQuestionFile(projectId, oppId, questionFileId, {
    status: 'PROCESSING',
    executionArn,
  });

  setAuditContext(event, {
    action: 'PIPELINE_STARTED',
    resource: 'question_file',
    resourceId: questionFileId,
    changes: {
      after: { projectId, oppId, questionFileId, executionArn },
    },
  });

  return apiResponse(202, {
    message: 'Question pipeline started',
    questionFileId,
    executionArn,
    startDate,
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
