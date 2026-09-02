/**
 * DELETE /related-rfps/{relatedOppKey}?orgId&projectId&oppId
 *
 * Remove a related-RFP link (HOR-2610). RBAC split by origin:
 *   - MANUAL links: any opportunity editor may remove (base `opportunity:edit`).
 *   - AUTO links:   admin-only — additionally requires `related_rfp:remove_auto`,
 *                   and writes a suppression tombstone so a later refresh does
 *                   NOT re-add the removed match.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { getRelatedRfp, deleteRelatedRfp, addSuppression } from '@/helpers/related-rfp';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const relatedOppKey = event.pathParameters?.relatedOppKey
    ? decodeURIComponent(event.pathParameters.relatedOppKey)
    : undefined;
  const { orgId, projectId, oppId } = event.queryStringParameters ?? {};

  if (!relatedOppKey) return apiResponse(400, { message: 'relatedOppKey is required' });
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!oppId) return apiResponse(400, { message: 'oppId is required' });

  const existing = await getRelatedRfp(orgId, projectId, oppId, relatedOppKey);
  if (!existing) return apiResponse(404, { message: 'Related RFP not found' });

  // AUTO links are admin-only to remove — the ticket's acceptance criterion.
  if (existing.origin === 'AUTO' && !event.rbac?.permissions.includes('related_rfp:remove_auto')) {
    return apiResponse(403, {
      message: 'Removing an auto-added related RFP requires admin permissions',
    });
  }

  await deleteRelatedRfp(orgId, projectId, oppId, relatedOppKey);

  // Tombstone AUTO removals so discovery does not resurface them.
  const userId = getUserId(event);
  if (existing.origin === 'AUTO') {
    await addSuppression(orgId, projectId, oppId, relatedOppKey, userId ?? undefined);
  }

  setAuditContext(event, {
    action: 'RELATED_RFP_REMOVED',
    resource: 'opportunity',
    resourceId: oppId,
    orgId,
    changes: { before: { relatedOppKey, origin: existing.origin, projectId } },
  });

  return apiResponse(200, { message: 'Related RFP removed' });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
