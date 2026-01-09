import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '../sentry-lambda';
import { apiResponse, getOrgId } from '../helpers/api';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

import { OpportunityItemSchema } from '@auto-rfp/shared';
import { createOpportunity } from '../helpers/opportunity';

// TODO Kate
const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(401, { ok: false, error: 'Unauthorized' });
    }
    const bodyRaw = JSON.parse(event.body || '');
    const { success, data, error } = OpportunityItemSchema.safeParse(bodyRaw);

    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Invalid request body',
        details: error.flatten(),
      });
    }

    const { projectId } = data;

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
  } catch (err: any) {
    return apiResponse(500, {
      ok: false,
      error: err?.message ?? 'Internal Server Error',
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
