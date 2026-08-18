/**
 * GET /related-rfps?orgId&projectId&oppId
 *
 * Lists the related-RFP link records for an opportunity (HOR-2610).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { listRelatedRfps } from '@/helpers/related-rfp';
import type { RelatedRfpListItem } from '@auto-rfp/core';

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId, oppId } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!oppId) return apiResponse(400, { message: 'oppId is required' });

  const rows = await listRelatedRfps(orgId, projectId, oppId);

  const items: RelatedRfpListItem[] = rows
    .map((r) => ({
      id: r.id,
      relatedOppKey: r.relatedOppKey,
      title: r.title,
      organizationName: r.organizationName,
      postedDateIso: r.postedDateIso,
      dueDateIso: r.dueDateIso,
      sourceUrl: r.sourceUrl,
      matchScore: r.matchScore,
      origin: r.origin,
      linkedOpportunityId: r.linkedOpportunityId,
      createdAt: r.createdAt,
      createdByName: r.createdByName,
    }))
    // AUTO first (highest score), then MANUAL; within a group by score desc.
    .sort((a, b) => {
      if (a.origin !== b.origin) return a.origin === 'AUTO' ? -1 : 1;
      return (b.matchScore ?? 0) - (a.matchScore ?? 0);
    });

  return apiResponse(200, { items });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
