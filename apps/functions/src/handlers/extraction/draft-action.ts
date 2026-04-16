import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import {
  confirmDraftPastProject,
  confirmDraftLaborRate,
  confirmDraftBOMItem,
  discardDraft,
} from '@/helpers/extraction';
import {
  type AuditResource,
  type DraftType,
  type PastProject,
  DraftActionRequestSchema,
} from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const DRAFT_TYPE_TO_RESOURCE: Record<DraftType, AuditResource> = {
  PAST_PERFORMANCE: 'past_project',
  LABOR_RATE: 'labor_rate',
  BOM_ITEM: 'bom_item',
};

/**
 * Consolidated handler for draft actions (confirm/discard)
 * Supports all draft types: PAST_PERFORMANCE, LABOR_RATE, BOM_ITEM
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  // Parse and validate request body with Zod schema
  const parseResult = DraftActionRequestSchema.safeParse(
    JSON.parse(event.body || '{}')
  );
  
  if (!parseResult.success) {
    return apiResponse(400, { ok: false, error: 'Invalid request body', issues: parseResult.error.issues });
  }
  
  const { orgId, draftId, action, draftType: type, updates } = parseResult.data;

  const userId = event.auth?.userId || 'system';

  if (action === 'confirm') {
    // Properly typed result - each confirm function returns its specific type or null
    type ConfirmResult = PastProject | { laborRateId: string } | { bomItemId: string } | null;
    let result: ConfirmResult = null;

    switch (type) {
      case 'PAST_PERFORMANCE':
        result = await confirmDraftPastProject(orgId, draftId, userId, updates);
        break;
      case 'LABOR_RATE':
        result = await confirmDraftLaborRate(orgId, draftId, userId, updates);
        break;
      case 'BOM_ITEM':
        result = await confirmDraftBOMItem(orgId, draftId, userId, updates);
        break;
    }

    if (!result) {
      return apiResponse(404, { ok: false, error: 'Draft not found' });
    }

    setAuditContext(event, {
      action: 'EXTRACTION_DRAFT_CONFIRMED',
      resource: DRAFT_TYPE_TO_RESOURCE[type],
      resourceId: draftId,
    });

    return apiResponse(200, { ok: true, result, draftType: type });
  }

  // action === 'discard'
  const discarded = await discardDraft(type, orgId, draftId);

  if (!discarded) {
    return apiResponse(404, { ok: false, error: 'Draft not found' });
  }

  setAuditContext(event, {
    action: 'EXTRACTION_DRAFT_DISCARDED',
    resource: DRAFT_TYPE_TO_RESOURCE[type],
    resourceId: draftId,
  });

  return apiResponse(200, { ok: true, message: 'Draft discarded' });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
