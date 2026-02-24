import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { apiResponse, getOrgId, getUserId } from '@/helpers/api';

import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';
import { createQuestionFile } from '@/helpers/questionFile';
import { CreateQuestionFileRequestSchema } from '@auto-rfp/core';

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'OrgId is missing' });
    }
    const bodyRaw = JSON.parse(event.body || '{}');

    const { success, data, error: errors } = CreateQuestionFileRequestSchema.safeParse(bodyRaw);
    if (!success) {
      return apiResponse(400, { message: errors.message });
    }

    const created = await createQuestionFile(orgId, data);

    
    setAuditContext(event, {
      action: 'DOCUMENT_UPLOADED',
      resource: 'document',
      resourceId: 'question-file',
    });

    return apiResponse(201, created);
  } catch (err) {
    console.error('create-question-file error:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
