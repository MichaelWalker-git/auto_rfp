import { withSentryLambda } from '@/sentry-lambda';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';

import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from 'middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from 'middleware/audit-middleware';
import middy from '@middy/core';
import { apiResponse } from 'helpers/api';
import { SyncToApnRequestSchema } from '@auto-rfp/core';
import { syncToPartnerCentral } from 'helpers/apn-client';


export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  let body: unknown;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return apiResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { success, data, error } = SyncToApnRequestSchema.safeParse(body);
  if (!success) {
    return apiResponse(400, {
      ok: false,
      error: 'Invalid request body',
      details: error.flatten(),
    });
  }

  const result = await syncToPartnerCentral(data);

  setAuditContext(event, {
    action: result.apnSyncError ? 'APN_REGISTRATION_FAILED' : 'APN_REGISTRATION_COMPLETED',
    resource: 'apn_registration',
    resourceId: data.oppId,
    orgId: data.orgId,
    changes: { after: result },
  });

  return apiResponse(200, {
    ok: !result.apnSyncError,
    apnOpportunityId: result.apnOpportunityId,
    apnSyncError: result.apnSyncError,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('apn:sync'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);