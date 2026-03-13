import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

import { updateOpportunity, getOpportunity } from '@/helpers/opportunity';
import { OpportunityItemSchema } from '@auto-rfp/core';
import { resolveUserNames } from '@/helpers/resolve-users';
import { STAGE_TO_APN_STATUS_MAP } from '@/constants/apn';

// Schema for update request - all fields optional except identifiers
const UpdateOpportunityRequestSchema = z.object({
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  patch: OpportunityItemSchema.partial().omit({
    orgId: true,
    projectId: true,
    oppId: true,
  }),
});

/**
 * Update an existing opportunity
 */
const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    console.log('Update Opportunity Event:', JSON.stringify(event, null, 2));

    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, {
        ok: false,
        error: 'Missing orgId',
      });
    }

    const body = JSON.parse(event.body || '{}');
    const { projectId, oppId, patch } = UpdateOpportunityRequestSchema.parse(body);

    // Verify opportunity exists
    const existing = await getOpportunity({ orgId, projectId, oppId });
    if (!existing) {
      return apiResponse(404, {
        ok: false,
        error: 'Opportunity not found',
      });
    }

    const userId = getUserId(event);

    // Resolve the caller's display name from the user table
    let userName: string | undefined;
    if (userId && orgId) {
      const nameMap = await resolveUserNames(orgId, [userId]);
      userName = nameMap[userId];
    }

    // Update the opportunity
    const { item } = await updateOpportunity({
      orgId,
      projectId,
      oppId,
      patch,
      userContext: { userId, userName },
    });

    // Sync to APN if the opportunity is in a stage that should be synced
    const apnSyncStages = ['SUBMITTED', 'WON', 'LOST', 'NO_BID', 'WITHDRAWN'];
    const currentStage = item.stage ?? 'IDENTIFIED';

    if (apnSyncStages.includes(currentStage)) {
      const proposalStatus = STAGE_TO_APN_STATUS_MAP[currentStage] ?? 'PROSPECT';

      // APN sync (awaited to prevent Lambda termination before completion)
      const { syncOpportunityToApn } = await import('@/helpers/apn-db');
      await syncOpportunityToApn({
        orgId,
        projectId,
        oppId,
        customerName:      item.organizationName ?? item.title ?? 'Unknown Customer',
        opportunityTitle:  item.title ?? 'Untitled Opportunity',
        opportunityValue:  item.baseAndAllOptionsValue ?? 0,
        expectedCloseDate: item.responseDeadlineIso ?? new Date().toISOString(),
        proposalStatus,
        description:       item?.description?.substring(0, 500),
        existingApnId:     item.apnOpportunityId ?? null,
      });
    }

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: event.pathParameters?.opportunityId ?? event.queryStringParameters?.opportunityId ?? 'unknown',
    });

    return apiResponse(200, {
      ok: true,
      oppId,
      item,
    });
  } catch (err: unknown) {
    console.error('Update opportunity error:', err);

    if (err instanceof Error && err.name === 'ZodError') {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: (err as z.ZodError).errors,
      });
    }

    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, {
        ok: false,
        error: 'Opportunity not found',
      });
    }

    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal Server Error',
    });
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(auditMiddleware())
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit')),
);
