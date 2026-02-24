/**
 * PUT /opportunity-context/override
 *
 * Upserts a user override (PINNED or EXCLUDED) for a context item.
 * Creates the context record if it doesn't exist yet.
 *
 * Body: UpsertContextOverrideDTO
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { putItem, getItem } from '@/helpers/db';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

import {
  UpsertContextOverrideDTOSchema,
  OPPORTUNITY_CONTEXT_PK,
  createOpportunityContextSK,
  type ContextOverride,
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
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(401, { error: 'Unauthorized' });

  const userId = getUserId(event) ?? 'unknown';

  if (!event.body) return apiResponse(400, { error: 'Request body is required' });

  const { success, data, error } = UpsertContextOverrideDTOSchema.safeParse(
    JSON.parse(event.body),
  );
  if (!success) {
    return apiResponse(400, { error: 'Invalid request body', issues: error.issues });
  }

  const { projectId, opportunityId, item, action } = data;

  // Load existing record (or create a new one)
  const existing = await loadRecord(orgId, projectId, opportunityId);
  const now = nowIso();

  const newOverride: ContextOverride = {
    id: item.id,
    source: item.source,
    action,
    label: item.title || item.id,
    addedAt: now,
    addedBy: userId,
  };

  // Replace any existing override for this item id, then add the new one
  const existingOverrides: ContextOverride[] = existing?.overrides ?? [];
  const updatedOverrides = [
    ...existingOverrides.filter((o) => o.id !== item.id),
    newOverride,
  ];

  const record: OpportunityContextRecord = {
    projectId,
    opportunityId,
    orgId,
    suggestedItems: existing?.suggestedItems ?? [],
    overrides: updatedOverrides,
    lastRefreshedAt: existing?.lastRefreshedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await saveRecord(record);

  
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'opportunity-context',
    });

    return apiResponse(200, {
    ok: true,
    override: newOverride,
    totalOverrides: updatedOverrides.length,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(auditMiddleware())
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit')),
);
