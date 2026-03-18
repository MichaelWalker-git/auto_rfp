import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { CreateStaffingPlanSchema, type StaffingPlan } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { createStaffingPlanRecord, resolveStaffingPlanItems } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event.body || '{}');
    const { success, data, error } = CreateStaffingPlanSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const userId = event.auth?.userId || 'unknown';
    const now = nowIso();

    // Resolve labor items against org labor rates
    let resolved;
    try {
      resolved = await resolveStaffingPlanItems(data.orgId, data.laborItems);
    } catch (resolveErr: unknown) {
      return apiResponse(400, {
        message: resolveErr instanceof Error ? resolveErr.message : 'Failed to resolve labor rates',
      });
    }

    const staffingPlan: StaffingPlan = {
      staffingPlanId: uuidv4(),
      orgId: data.orgId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      name: data.name,
      laborItems: resolved.items,
      totalLaborCost: resolved.totalLaborCost,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const result = await createStaffingPlanRecord(staffingPlan);

    return apiResponse(201, { staffingPlan: result });
  } catch (err: unknown) {
    console.error('Error in createStaffingPlan handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('pricing:create'))
    .use(httpErrorMiddleware()),
);
