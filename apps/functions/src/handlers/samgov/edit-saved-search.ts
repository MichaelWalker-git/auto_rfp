import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { UpdateCommand, } from "@aws-sdk/lib-dynamodb";

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { nowIso } from '@/helpers/date';
import { PatchSchema, PatchType, SavedSearch, SavedSearchSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import { SAVED_SEARCH_PK } from '@/constants/samgov';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

function decodeId(id?: string) {
  try {
    return id ? decodeURIComponent(id) : '';
  } catch {
    return id ?? '';
  }
}

function buildUpdate(patch: PatchType, updatedAt: string) {
  const setExpr: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, any> = {};

  const addSet = (attr: string, value: any) => {
    const nk = `#${attr}`;
    const vk = `:${attr}`;
    names[nk] = attr;
    values[vk] = value;
    setExpr.push(`${nk} = ${vk}`);
  };

  if (patch.name !== undefined) addSet('name', patch.name.trim());
  if (patch.criteria !== undefined) addSet('criteria', patch.criteria);
  if (patch.frequency !== undefined) addSet('frequency', patch.frequency);
  if (patch.autoImport !== undefined) addSet('autoImport', patch.autoImport);
  if (patch.notifyEmails !== undefined) addSet('notifyEmails', patch.notifyEmails);
  if (patch.isEnabled !== undefined) addSet('isEnabled', patch.isEnabled);

  addSet('updatedAt', updatedAt);

  return {
    UpdateExpression: `SET ${setExpr.join(', ')}`,
    ExpressionAttributeNames: {
      ...names,
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
    ExpressionAttributeValues: values,
  };
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgIdFromAuth = (event as any)?.auth?.orgId as string | undefined;

    const orgId = (event.queryStringParameters?.orgId ?? orgIdFromAuth ?? '').trim();
    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    if (orgIdFromAuth && event.queryStringParameters?.orgId && orgId !== orgIdFromAuth) {
      return apiResponse(403, { message: 'orgId mismatch' });
    }

    const savedSearchId = decodeId(event.pathParameters?.id);

    if (!savedSearchId) {
      return apiResponse(400, { message: 'savedSearchId is required in path' });
    }

    if (!event.body) return apiResponse(400, { message: 'Request body is required' });

    let raw: unknown;
    try {
      raw = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON body' });
    }

    const parsed = PatchSchema.safeParse(raw);
    if (!parsed.success) {
      return apiResponse(400, { message: 'Validation error', errors: parsed.error.format() });
    }

    const patch = parsed.data;
    const updatedAt = nowIso();

    const pk = SAVED_SEARCH_PK;
    const sk = `${orgId}#${savedSearchId}`;

    const update = buildUpdate(patch, updatedAt);

    const res = await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: pk,
          [SK_NAME]: sk,
        },
        ...update,
        ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    const item = res.Attributes as any;
    if (!item) return apiResponse(500, { message: 'Empty update result' });

    const validated = SavedSearchSchema.safeParse(item);
    if (!validated.success) {
      return apiResponse(500, {
        message: 'Invalid saved search payload (internal)',
        errors: validated.error.format(),
      });
    }

    return apiResponse(200, validated.data as SavedSearch);
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Saved search not found' });
    }

    console.error('Error in edit-saved-search:', err);
    return apiResponse(500, {
      message: 'Failed to update saved search',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(httpErrorMiddleware()),
);
