import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { createEngagementLog } from '@/helpers/engagement-log';
import { CreateEngagementLogSchema } from '@auto-rfp/core';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(401, { ok: false, error: 'Unauthorized' });
  }

  // Parse body
  let body: unknown;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return apiResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  // Validate with Zod schema
  const parseResult = CreateEngagementLogSchema.safeParse(body);
  if (!parseResult.success) {
    return apiResponse(400, {
      ok: false,
      error: 'Invalid request body',
      details: parseResult.error.flatten(),
    });
  }

  const { projectId, opportunityId, ...engagement } = parseResult.data;

  // Create the engagement log entry
  const result = await createEngagementLog({
    orgId,
    projectId,
    opportunityId,
    engagement,
  });

  setAuditContext(event, {
    action: 'ENGAGEMENT_LOG_CREATED',
    resource: 'engagement-log',
    resourceId: result.engagementId,
    orgId,
    changes: {
      after: {
        interactionType: engagement.interactionType,
        direction: engagement.direction,
        contactName: engagement.contactName,
      },
    },
  });

  return apiResponse(201, {
    ok: true,
    item: result.item,
    engagementId: result.engagementId,
  });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware()),
);
