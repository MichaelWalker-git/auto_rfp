/**
 * Save (or clear) a per-org Bedrock configuration.
 * POST /bedrock/set-config
 *
 * Body: { orgId, apiKey, fallbackModelId? }
 *   - A non-empty `apiKey` stores the Bearer key in Secrets Manager and writes
 *     the non-secret config (fallback model) to DynamoDB.
 *   - An empty `apiKey` ('') CLEARS the config — deletes both the secret and the
 *     DynamoDB record (delete semantics, matching the sibling integration cards).
 *
 * Before storing, the handler probes the submitted key against every required
 * model (ticket 04). On a rejected probe nothing is stored and a 422 returns
 * the exact list of models the key can't invoke; on accept the secret + config
 * are written and the probe result is persisted as `lastProbe`.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { BedrockConfigSaveRequestSchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { deleteApiKey, storeApiKey } from '@/helpers/api-key-storage';
import { deleteBedrockConfig, upsertBedrockConfig } from '@/helpers/bedrock-config';
import { probeBedrockKey } from '@/helpers/bedrock-probe';
import { BEDROCK_SECRET_PREFIX } from '@/constants/bedrock-config';

export const saveBedrockConfig = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let raw: unknown;
  try {
    raw = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { message: 'Invalid JSON body' });
  }

  const { success, data, error } = BedrockConfigSaveRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const { orgId, apiKey, fallbackModelId } = data;

  // Empty key ⇒ clear both the secret and the non-secret config.
  if (apiKey.trim() === '') {
    await deleteApiKey(orgId, BEDROCK_SECRET_PREFIX);
    await deleteBedrockConfig(orgId);

    setAuditContext(event, {
      action: 'API_KEY_DELETED',
      resource: 'api_key',
      resourceId: `bedrock-api-key-${orgId}`,
    });

    return apiResponse(200, { ok: true, cleared: true, orgId });
  }

  // Probe the SUBMITTED key against every required model before storing anything.
  const { probe, accepted, missing } = await probeBedrockKey({ apiKey, fallbackModelId });

  if (!accepted) {
    // Reject: store nothing, surface the exact models the key can't invoke.
    return apiResponse(422, {
      ok: false,
      message: 'The Bedrock key could not invoke all required models',
      missingModels: missing,
      probe,
    });
  }

  await storeApiKey(orgId, BEDROCK_SECRET_PREFIX, apiKey);
  const config = await upsertBedrockConfig({ orgId, fallbackModelId, lastProbe: probe });

  setAuditContext(event, {
    action: 'API_KEY_CREATED',
    resource: 'api_key',
    resourceId: `bedrock-api-key-${orgId}`,
  });

  return apiResponse(200, {
    ok: true,
    orgId,
    fallbackModelId: config.fallbackModelId,
    probe,
  });
};

export const handler = withSentryLambda(
  middy(saveBedrockConfig)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
