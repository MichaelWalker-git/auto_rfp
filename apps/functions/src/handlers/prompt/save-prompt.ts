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

import {
  DocumentPromptItemSchema,
  type PromptItem,
  PromptItemSchema,
  PromptScopeSchema,
  SaveDocumentPromptBodySchema,
  SavePromptBodySchema,
} from '@auto-rfp/core';
import { saveDocumentPrompt, saveSystemPrompt, saveUserPrompt } from '@/helpers/prompt';

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

  // Document-generation prompt override (discriminated by documentType presence)
  const isDocumentPrompt =
    typeof bodyRaw === 'object' &&
    bodyRaw !== null &&
    'documentType' in bodyRaw &&
    typeof bodyRaw.documentType === 'string';
  if (isDocumentPrompt) {
    const { success, data, error } = SaveDocumentPromptBodySchema.safeParse(bodyRaw);
    if (!success) {
      return apiResponse(400, { ok: false, error: error.flatten() });
    }

    const saved = await saveDocumentPrompt(orgId, scope, data.documentType, data.prompt);

    const { success: savedOk, data: item, error: savedError } =
      DocumentPromptItemSchema.safeParse({ ...saved, orgId: saved?.orgId ?? orgId });
    if (!savedOk) {
      return apiResponse(500, {
        ok: false,
        error: 'Saved item failed validation',
        issues: savedError.flatten(),
      });
    }

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'prompt',
    });

    return apiResponse(200, { ok: true, item });
  }

  const { success: bodyOk, data: body, error: bodyError } = SavePromptBodySchema.safeParse(bodyRaw);
  if (!bodyOk) {
    return apiResponse(400, { ok: false, error: bodyError.flatten() });
  }

  const { type, prompt, params } = body;

  const saved =
    scope === 'SYSTEM'
      ? await saveSystemPrompt(orgId, type, prompt, params)
      : await saveUserPrompt(orgId, type, prompt, params);

  const { success: savedOk, data: item, error: savedError } =
    PromptItemSchema.safeParse({ ...saved, orgId: saved?.orgId ?? orgId });
  if (!savedOk) {
    return apiResponse(500, {
      ok: false,
      error: 'Saved item failed validation',
      issues: savedError.flatten(),
    });
  }

  setAuditContext(event, {
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceId: 'prompt',
  });

  return apiResponse(200, { ok: true, item: item as PromptItem });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('prompt:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
