/**
 * GET /compliance-review/history
 *
 * Returns the compliance-review chat history for an opportunity.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { getOpportunity } from '@/helpers/opportunity';
import { listComplianceReviewHistory } from '@/helpers/compliance-review';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { ComplianceReviewHistoryResponseSchema } from '@auto-rfp/core';

const QueryParamsSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = QueryParamsSchema.safeParse(event.queryStringParameters);
  if (!success) {
    return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
  }
  const { orgId, projectId, opportunityId: oppId } = data;

  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) return apiResponse(404, { message: 'Opportunity not found' });

  const messages = await listComplianceReviewHistory(orgId, projectId, oppId);
  return apiResponse(200, ComplianceReviewHistoryResponseSchema.parse({ messages }));
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);
