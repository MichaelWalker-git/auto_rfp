import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

import { DeleteDocumentPromptBodySchema, PromptScopeSchema } from '@auto-rfp/core';
import { deleteDocumentPrompt } from '@/helpers/prompt';

/**
 * Reset a document-generation prompt override to its hardcoded default by
 * deleting the org's override row. v1 supports document prompts only;
 * feature-prompt reset can be added later by extending the body union.
 */
export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { ok: false, error: 'Missing orgId' });
  }

  const scopeRaw = event.pathParameters?.scope;
  const { success: scopeOk, data: scope } = PromptScopeSchema.safeParse(scopeRaw);
  if (!scopeOk) {
    return apiResponse(400, { ok: false, error: 'Invalid scope. Use SYSTEM or USER.' });
  }

  let bodyRaw: unknown = {};
  try {
    bodyRaw = event.body ? JSON.parse(event.body) : {};
  } catch {
    return apiResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { success, data, error } = DeleteDocumentPromptBodySchema.safeParse(bodyRaw);
  if (!success) {
    return apiResponse(400, { ok: false, error: error.flatten() });
  }

  await deleteDocumentPrompt(orgId, scope, data.documentType);

  setAuditContext(event, {
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceId: 'prompt',
  });

  return apiResponse(200, { ok: true });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('prompt:delete'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
