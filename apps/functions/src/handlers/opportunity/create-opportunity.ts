import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { OpportunityItemSchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { createOpportunity } from '@/helpers/opportunity';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
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

    const { item, oppId } = await createOpportunity({
      orgId,
      projectId: projectId ?? '',
      opportunity: data,
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
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:create')),
);
