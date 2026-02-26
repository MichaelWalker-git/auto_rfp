import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { OpportunityItemSchema } from '@auto-rfp/core';

import { apiResponse, getUserId } from '@/helpers/api';
import { createOpportunity } from '@/helpers/opportunity';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { resolveUserNames } from '@/helpers/resolve-users';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
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
      return apiResponse(400, {
        ok: false,
        error: 'orgId is required',
      });
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

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'opportunity',
    });

    return apiResponse(201, {
      ok: true,
      oppId,
      item,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return apiResponse(500, {
      ok: false,
      error: message,
    });
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
