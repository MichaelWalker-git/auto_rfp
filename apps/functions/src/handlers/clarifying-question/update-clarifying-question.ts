import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { updateClarifyingQuestion, getClarifyingQuestion } from '@/helpers/clarifying-question';
import { UpdateClarifyingQuestionSchema } from '@auto-rfp/core';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const PathParamsSchema = z.object({
  questionId: z.string().uuid(),
});

const QuerySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
});

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(401, { ok: false, error: 'Unauthorized' });
  }

  // Parse path parameters
  const pathParams = PathParamsSchema.safeParse(event.pathParameters);
  if (!pathParams.success) {
    return apiResponse(400, {
      ok: false,
      error: 'Invalid path parameters',
      details: pathParams.error.flatten(),
    });
  }

  // Parse query parameters
  const queryParams = QuerySchema.safeParse(event.queryStringParameters);
  if (!queryParams.success) {
    return apiResponse(400, {
      ok: false,
      error: 'projectId and opportunityId are required query parameters',
      details: queryParams.error.flatten(),
    });
  }

  // Parse body
  let body: unknown;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return apiResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const patchResult = UpdateClarifyingQuestionSchema.safeParse(body);
  if (!patchResult.success) {
    return apiResponse(400, {
      ok: false,
      error: 'Invalid request body',
      details: patchResult.error.flatten(),
    });
  }

  const { questionId } = pathParams.data;
  const { projectId, opportunityId } = queryParams.data;

  // Check if question exists
  const existing = await getClarifyingQuestion({
    orgId,
    projectId,
    opportunityId,
    questionId,
  });

  if (!existing) {
    return apiResponse(404, { ok: false, error: 'Clarifying question not found' });
  }

  // Update the question
  const result = await updateClarifyingQuestion({
    orgId,
    projectId,
    opportunityId,
    questionId,
    patch: patchResult.data,
  });

  setAuditContext(event, {
    action: 'CLARIFYING_QUESTION_UPDATED',
    resource: 'clarifying-question',
    resourceId: questionId,
    orgId,
    changes: {
      before: { status: existing.item.status },
      after: patchResult.data,
    },
  });

  return apiResponse(200, {
    ok: true,
    item: result.item,
  });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware()),
);
