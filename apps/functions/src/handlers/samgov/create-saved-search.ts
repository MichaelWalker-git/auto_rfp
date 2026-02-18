import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import {
  type CreateSavedSearchRequest,
  CreateSavedSearchRequestSchema,
  type SavedSearch,
  SavedSearchSchema,
} from '@auto-rfp/core';
import { nowIso } from '@/helpers/date';
import { SAVED_SEARCH_PK } from '@/constants/samgov';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

function newId() {
  return (globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function normalizeFrequency(f?: string) {
  const v = String(f ?? '').toUpperCase();
  if (v === 'HOURLY' || v === 'DAILY' || v === 'WEEKLY') return v as any;
  return 'DAILY' as any;
}

// ---------------- handler ----------------
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) return apiResponse(400, { message: 'Request body is required' });

    let raw: unknown;
    try {
      raw = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON body' });
    }

    const parsed = CreateSavedSearchRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return apiResponse(400, { message: 'Validation error', errors: parsed.error.format() });
    }

    const body: CreateSavedSearchRequest = parsed.data;

    const orgIdFromAuth = (event as any)?.auth?.orgId;
    if (orgIdFromAuth && body.orgId && body.orgId !== orgIdFromAuth) {
      return apiResponse(403, { message: 'orgId mismatch' });
    }

    const orgId = body.orgId ?? orgIdFromAuth;
    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    const savedSearchId = newId();
    const createdAt = nowIso();

    const itemCandidate: SavedSearch = {
      savedSearchId,
      orgId,
      name: body.name.trim(),
      criteria: body.criteria,
      frequency: normalizeFrequency(body.frequency),
      autoImport: Boolean(body.autoImport),
      notifyEmails: body.notifyEmails ?? [],
      isEnabled: body.isEnabled ?? true,
      lastRunAt: null,
      createdAt,
      updatedAt: createdAt,
    } as any;

    const validated = SavedSearchSchema.safeParse(itemCandidate);
    if (!validated.success) {
      return apiResponse(400, {
        message: 'Invalid saved search payload (internal)',
        errors: validated.error.format(),
      });
    }

    // PK/SK pattern:
    // PK = SAVED_SEARCH
    // SK = `${orgId}#${savedSearchId}`
    const pk = SAVED_SEARCH_PK;
    const sk = `${orgId}#${savedSearchId}`;

    await docClient.send(
      new PutCommand({
        TableName: DB_TABLE_NAME,
        Item: {
          [PK_NAME]: pk,
          [SK_NAME]: sk,
          ...validated.data,
        },
        // prevent accidental overwrite if id collision
        ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
      }),
    );

    return apiResponse(200, validated.data);
  } catch (err: any) {
    console.error('Error in create-saved-search:', err);
    return apiResponse(500, {
      message: 'Failed to create saved search',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:create'))
    .use(httpErrorMiddleware()),
);
