import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { UpdateLaborRateSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { getLaborRate, updateLaborRate, calculateFullyLoadedRate, computeOffshoreFullyLoadedRate } from '@/helpers/pricing';
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
    const { success, data, error } = UpdateLaborRateSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const userId = event.auth?.userId || 'unknown';
    const now = nowIso();

    // Build the final offshore buildup for a merged record. Sending offshoreBaseRate: null in
    // the update explicitly CLEARS the entire offshore buildup (fields set to undefined so the
    // full-overwrite putItem drops them). Otherwise recompute from the merged buildup.
    const resolveOffshoreFields = (merged: {
      offshoreBaseRate?: number | null;
      offshoreOverhead?: number | null;
      offshoreGa?: number | null;
      offshoreProfit?: number | null;
      offshoreRateJustification?: string | null;
    }) => {
      const cleared = merged.offshoreBaseRate == null;
      return {
        offshoreBaseRate: cleared ? undefined : merged.offshoreBaseRate,
        offshoreOverhead: cleared ? undefined : merged.offshoreOverhead ?? undefined,
        offshoreGa: cleared ? undefined : merged.offshoreGa ?? undefined,
        offshoreProfit: cleared ? undefined : merged.offshoreProfit ?? undefined,
        offshoreRateJustification: cleared ? undefined : merged.offshoreRateJustification ?? undefined,
        offshoreFullyLoadedRate: cleared ? undefined : computeOffshoreFullyLoadedRate(merged),
      };
    };

    // Get existing labor rate by ID
    const existing = await getLaborRate(data.orgId, data.laborRateId);
    if (!existing) {
      // Try to find by searching all rates for this org
      const { getLaborRatesByOrg } = await import('@/helpers/pricing');
      const allRates = await getLaborRatesByOrg(data.orgId);
      const found = allRates.find(r => r.laborRateId === data.laborRateId);
      if (!found) {
        return apiResponse(404, { message: 'Labor rate not found' });
      }

      // Merge updates
      const merged = { ...found, ...data };
      const fullyLoadedRate = calculateFullyLoadedRate(
        merged.baseRate,
        merged.overhead,
        merged.ga,
        merged.profit,
      );

      const updated = {
        ...merged,
        fullyLoadedRate,
        ...resolveOffshoreFields(merged),
        updatedAt: now,
        updatedBy: userId,
      };

      await updateLaborRate(updated);
      return apiResponse(200, { laborRate: updated });
    }

    // Merge updates
    const merged = { ...existing, ...data };
    const fullyLoadedRate = calculateFullyLoadedRate(
      merged.baseRate,
      merged.overhead,
      merged.ga,
      merged.profit,
    );

    const updated = {
      ...merged,
      fullyLoadedRate,
      ...resolveOffshoreFields(merged),
      updatedAt: now,
      updatedBy: userId,
    };

    await updateLaborRate(updated);
    return apiResponse(200, { laborRate: updated });
  } catch (err: unknown) {
    console.error('Error in updateLaborRate handler:', err);
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
    .use(requirePermission('pricing:edit'))
    .use(httpErrorMiddleware()),
);
