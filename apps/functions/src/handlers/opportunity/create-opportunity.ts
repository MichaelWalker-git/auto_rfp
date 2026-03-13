import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { OpportunityItemSchema } from '@auto-rfp/core';

import { apiResponse, getUserId } from '@/helpers/api';
import { createOpportunity } from '@/helpers/opportunity';
import { syncOpportunityToApn } from '@/helpers/apn-db';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { resolveUserNames } from '@/helpers/resolve-users';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const bodyRaw = JSON.parse(event.body || '{}');
    const { success, data, error: errors } = OpportunityItemSchema.safeParse(bodyRaw);

    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Invalid request body',
        details: errors.flatten(),
      });
    }

    const { projectId, orgId } = data;

    if (!orgId) {
      return apiResponse(400, { ok: false, error: 'orgId is required' });
    }

    const userId = getUserId(event);

    // Resolve the caller's display name from the user table
    let userName: string | undefined;
    if (userId && orgId) {
      const nameMap = await resolveUserNames(orgId, [userId]);
      userName = nameMap[userId];
    }

    const { item, oppId } = await createOpportunity({
      orgId,
      projectId: projectId ?? '',
      opportunity: data,
      userContext: { userId, userName },
    });

    // Map opportunity stage to APN proposal status
    const stageToApnStatusMap: Record<string, string> = {
      'IDENTIFIED':  'PROSPECT',
      'QUALIFYING':  'PROSPECT', 
      'PURSUING':    'PROSPECT',
      'SUBMITTED':   'SUBMITTED',
      'WON':         'WON',
      'LOST':        'LOST',
      'NO_BID':      'LOST',
      'WITHDRAWN':   'LOST',
    };

    const opportunityStage = item.stage ?? 'IDENTIFIED';
    const proposalStatus = stageToApnStatusMap[opportunityStage] ?? 'PROSPECT';

    // Sync to AWS Partner Central (awaited to prevent Lambda shutdown before completion)
    await syncOpportunityToApn({
      orgId,
      projectId: projectId ?? '',
      oppId,
      customerName:      item.organizationName ?? item.title ?? 'Unknown Customer',
      opportunityTitle:  item.title ?? 'Untitled Opportunity',
      opportunityValue:  item.baseAndAllOptionsValue ?? 0,
      expectedCloseDate: item.responseDeadlineIso ?? new Date().toISOString(),
      proposalStatus,
      description:       item?.description?.substring(0, 500),
    });

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'opportunity',
    });

    return apiResponse(201, { ok: true, oppId, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return apiResponse(500, { ok: false, error: message });
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(auditMiddleware())
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:create')),
);
