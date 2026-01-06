import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

import { type PromptItem, PromptItemSchema, PromptScopeSchema, SavePromptBodySchema, } from '@auto-rfp/shared';
import { saveSystemPrompt, saveUserPrompt } from '../helpers/propmt';

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { ok: false, error: 'Missing orgId' });
  }

  const scopeRaw = event.pathParameters?.scope;
  const scopeParsed = PromptScopeSchema.safeParse(scopeRaw);
  if (!scopeParsed.success) {
    return apiResponse(400, { ok: false, error: 'Invalid scope. Use SYSTEM or USER.' });
  }
  const scope = scopeParsed.data;

  let bodyRaw: unknown = {};
  try {
    bodyRaw = event.body ? JSON.parse(event.body) : {};
  } catch {
    return apiResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const bodyParsed = SavePromptBodySchema.safeParse(bodyRaw);
  if (!bodyParsed.success) {
    return apiResponse(400, { ok: false, error: bodyParsed.error.flatten() });
  }

  const { type, prompt, params } = bodyParsed.data;

  const saved =
    scope === 'SYSTEM'
      ? await saveSystemPrompt(orgId, type, prompt, params)
      : await saveUserPrompt(orgId, type, prompt, params);

  const validated = PromptItemSchema.safeParse({ ...saved, orgId: saved?.orgId ?? orgId });
  if (!validated.success) {
    return apiResponse(500, {
      ok: false,
      error: 'Saved item failed validation',
      issues: validated.error.flatten(),
    });
  }

  return apiResponse(200, { ok: true, item: validated.data as PromptItem });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('prompt:create'))
    .use(httpErrorMiddleware()),
);
