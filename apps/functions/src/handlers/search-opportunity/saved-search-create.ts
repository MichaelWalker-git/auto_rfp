/**
 * Unified create-saved-search handler.
 * POST /search-opportunities/saved-search
 *
 * Body: CreateSavedSearchRequest (includes source: 'SAM_GOV' | 'DIBBS')
 * All saved searches are stored in a single DynamoDB entity under SAVED_SEARCH_PK.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

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
import { CreateSavedSearchRequestSchema, SavedSearchSchema } from '@auto-rfp/core';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { SAVED_SEARCH_PK } from '@/constants/samgov';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const newId = (): string =>
  (globalThis.crypto as { randomUUID?: () => string })?.randomUUID?.() ??
  `${Date.now()}-${Math.random()}`;

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });
  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = CreateSavedSearchRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const orgId = data.orgId ?? event.auth?.orgId;
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const savedSearchId = newId();
  const now = nowIso();

  const candidate = {
    savedSearchId,
    orgId,
    source:       data.source ?? 'SAM_GOV',
    name:         data.name.trim(),
    criteria:     data.criteria,
    frequency:    data.frequency ?? 'DAILY',
    autoImport:   data.autoImport ?? false,
    notifyEmails: data.notifyEmails ?? [],
    isEnabled:    data.isEnabled ?? true,
    lastRunAt:    null,
    createdAt:    now,
    updatedAt:    now,
  };

  const { success: vs, data: validated, error: ve } = SavedSearchSchema.safeParse(candidate);
  if (!vs) return apiResponse(400, { message: 'Internal validation error', issues: ve.issues });

  await docClient.send(new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: { [PK_NAME]: SAVED_SEARCH_PK, [SK_NAME]: `${orgId}#${savedSearchId}`, ...validated },
    ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
    ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
  }));

  setAuditContext(event, { action: 'CONFIG_CHANGED', resource: 'config', resourceId: savedSearchId });
  return apiResponse(200, validated);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
