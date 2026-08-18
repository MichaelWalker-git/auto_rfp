/**
 * POST /related-rfps
 *
 * Manually add a past RFP as related to the current opportunity (HOR-2610).
 * Always stored with origin=MANUAL (server-forced — a client cannot forge AUTO).
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
import { resolveUserNames } from '@/helpers/resolve-users';
import { createRelatedRfp, resolveLinkedOpportunityId } from '@/helpers/related-rfp';
import { RelatedRfpCreateRequestSchema } from '@auto-rfp/core';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = RelatedRfpCreateRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const { orgId, projectId, oppId, relatedOppKey } = data;

  const userId = getUserId(event);
  const nameMap = userId
    ? await resolveUserNames(orgId, [userId]).catch(() => ({} as Record<string, string>))
    : {};

  const linkedOpportunityId = await resolveLinkedOpportunityId(orgId, relatedOppKey);

  const item = await createRelatedRfp({
    ...data,
    origin: 'MANUAL', // server-forced
    linkedOpportunityId,
    ...(userId ? { createdBy: userId, createdByName: nameMap[userId] } : {}),
  });

  setAuditContext(event, {
    action: 'RELATED_RFP_ADDED',
    resource: 'opportunity',
    resourceId: oppId,
    orgId,
    changes: { after: { relatedOppKey, origin: 'MANUAL', projectId } },
  });

  return apiResponse(201, { item });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
