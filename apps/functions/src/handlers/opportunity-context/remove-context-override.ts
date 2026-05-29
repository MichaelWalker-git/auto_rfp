/**
 * DELETE /opportunity-context/override
 *
 * Removes a user override (PINNED or EXCLUDED) for a context item,
 * restoring it to the default auto-suggested state.
 *
 * Body: RemoveContextOverrideDTO
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { putItem, getItem } from '@/helpers/db';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import {
  RemoveContextOverrideDTOSchema,
  OPPORTUNITY_CONTEXT_PK,
  createOpportunityContextSK,
  type OpportunityContextRecord,
} from '@auto-rfp/core';

// ─── DynamoDB helpers ─────────────────────────────────────────────────────────

async function loadRecord(
  orgId: string,
  projectId: string,
  opportunityId: string,
): Promise<OpportunityContextRecord | null> {
  return getItem<OpportunityContextRecord>(
    OPPORTUNITY_CONTEXT_PK,
    createOpportunityContextSK(orgId, projectId, opportunityId),
  );
}

async function saveRecord(record: OpportunityContextRecord): Promise<void> {
  await putItem(
    OPPORTUNITY_CONTEXT_PK,
    createOpportunityContextSK(record.orgId, record.projectId, record.opportunityId),
    record,
    true, // preserveCreatedAt
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(401, { error: 'Unauthorized' });

  if (!event.body) return apiResponse(400, { error: 'Request body is required' });

  const { success, data, error } = RemoveContextOverrideDTOSchema.safeParse(
    JSON.parse(event.body),
  );
  if (!success) {
    return apiResponse(400, { error: 'Invalid request body', issues: error.issues });
  }

  const { projectId, opportunityId, itemId } = data;

  const existing = await loadRecord(orgId, projectId, opportunityId);
  if (!existing) {
    return apiResponse(404, { error: 'Context record not found' });
  }

  const updatedOverrides = existing.overrides.filter((o) => o.id !== itemId);

  if (updatedOverrides.length === existing.overrides.length) {
    // Nothing was removed — item wasn't overridden
    return apiResponse(200, { ok: true, removed: false });
  }

  const now = nowIso();
  const record: OpportunityContextRecord = {
    ...existing,
    overrides: updatedOverrides,
    updatedAt: now,
  };

  await saveRecord(record);

  return apiResponse(200, {
    ok: true,
    removed: true,
    totalOverrides: updatedOverrides.length,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit')),
);
