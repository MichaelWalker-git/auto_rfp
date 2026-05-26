import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { getOpportunity } from '@/helpers/opportunity';
import { listChatHistory } from '@/helpers/opportunity-assistant';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { OpportunityAssistantHistoryResponseSchema } from '@auto-rfp/core';

const QueryParamsSchema = z.object({
  opportunityId: z.string().min(1, 'opportunityId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  orgId: z.string().min(1, 'orgId is required'),
});

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = QueryParamsSchema.safeParse(event.queryStringParameters);
  if (!success) {
    return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
  }

  const { opportunityId: oppId, projectId, orgId } = data;

  // Verify opportunity exists and user has access
  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) {
    return apiResponse(404, { message: 'Opportunity not found' });
  }

  const rawMessages = await listChatHistory(oppId);

  // Sanitize old data that may have invalid relevance scores
  const messages = rawMessages.map(msg => ({
    ...msg,
    sources: msg.sources?.map(source => ({
      ...source,
      // Clamp relevance to 0-1 range (old data may have negative scores)
      relevance: Math.max(0, Math.min(1, source.relevance ?? 0)),
    })),
  }));

  const response = OpportunityAssistantHistoryResponseSchema.parse({ messages });
  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);
