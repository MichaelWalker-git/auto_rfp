import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import { updateOpportunity, getOpportunity } from '@/helpers/opportunity';
import { OpportunityItemSchema } from '@auto-rfp/core';

// Schema for update request - all fields optional except identifiers
const UpdateOpportunityRequestSchema = z.object({
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  patch: OpportunityItemSchema.partial().omit({
    orgId: true,
    projectId: true,
    oppId: true,
  }),
});

/**
 * Update an existing opportunity
 */
const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    console.log('Update Opportunity Event:', JSON.stringify(event, null, 2));

    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, {
        ok: false,
        error: 'Missing orgId',
      });
    }

    const body = JSON.parse(event.body || '{}');
    const { projectId, oppId, patch } = UpdateOpportunityRequestSchema.parse(body);

    // Verify opportunity exists
    const existing = await getOpportunity({ orgId, projectId, oppId });
    if (!existing) {
      return apiResponse(404, {
        ok: false,
        error: 'Opportunity not found',
      });
    }

    // Update the opportunity
    const { item } = await updateOpportunity({
      orgId,
      projectId,
      oppId,
      patch,
    });

    return apiResponse(200, {
      ok: true,
      oppId,
      item,
    });
  } catch (err: any) {
    console.error('Update opportunity error:', err);

    if (err.name === 'ZodError') {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: err.errors,
      });
    }

    if (err.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, {
        ok: false,
        error: 'Opportunity not found',
      });
    }

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
    .use(requirePermission('opportunity:edit')),
);