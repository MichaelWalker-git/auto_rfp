import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { 
  CalculateEstimateRequestSchema, 
  type CalculateEstimateRequest,
  type CostEstimate,
  EstimateItemSchema
} from '@auto-rfp/core';

type EstimateItem = z.infer<typeof EstimateItemSchema>;
import { apiResponse } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import {
  createCostEstimate,
  getLaborRatesByOrg,
  getBOMItemsByOrg,
  calculateEstimateTotals,
  resolveRate,
  resolveRateBasisForOpportunity,
} from '@/helpers/pricing';
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
    const { success, data, error } = CalculateEstimateRequestSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const dto: CalculateEstimateRequest = data;
    const userId = event.auth?.userId || 'unknown';
    const now = nowIso();

    // Rate basis: explicit request value overrides; otherwise derive from the opportunity.
    const basis = dto.rateBasis ?? await resolveRateBasisForOpportunity(dto.orgId, dto.projectId, dto.opportunityId);
    const laborRates = await getLaborRatesByOrg(dto.orgId);
    const rateByPos = new Map(laborRates.map(r => [r.position, r]));

    // Calculate labor costs, resolving each position against the requested rate basis.
    // Track positions that fell back to onshore (OFFSHORE basis but no offshore rate on file)
    // so the response can surface them rather than silently billing at the onshore rate.
    const onshoreFallbackPositions: string[] = [];
    const laborCosts: EstimateItem[] = dto.laborItems.map(item => {
      const laborRate = rateByPos.get(item.position);
      const resolved = laborRate
        ? resolveRate(laborRate, basis)
        : { rate: 0, basisUsed: 'ONSHORE' as const, fellBackToOnshore: false };
      if (resolved.fellBackToOnshore) onshoreFallbackPositions.push(item.position);
      const totalCost = item.hours * resolved.rate;
      return {
        category: 'LABOR',
        name: item.position,
        quantity: item.hours,
        unitCost: resolved.rate,
        totalCost,
        rateBasis: resolved.basisUsed,
      };
    });

    // Calculate BOM costs if provided
    const materialCosts: EstimateItem[] = [];
    if (dto.bomItems?.length) {
      const bomItems = await getBOMItemsByOrg(dto.orgId);
      const bomMap = new Map(bomItems.map(b => [b.bomItemId, b]));
      
      for (const bomRef of dto.bomItems) {
        const bomItem = bomMap.get(bomRef.bomItemId);
        if (bomItem) {
          materialCosts.push({
            category: bomItem.category as 'HARDWARE' | 'SOFTWARE' | 'MATERIALS' | 'SUBCONTRACTOR' | 'TRAVEL' | 'ODC',
            name: bomItem.name,
            quantity: bomRef.quantity,
            unitCost: bomItem.unitCost,
            totalCost: bomRef.quantity * bomItem.unitCost,
          });
        }
      }
    }

    // Calculate totals (10% default margin for estimates)
    const totals = calculateEstimateTotals(
      laborCosts,
      materialCosts,
      [], // travel
      [], // subcontractor  
      [], // odc
      10  // 10% margin
    );

    const estimate: CostEstimate = {
      estimateId: uuidv4(),
      orgId: dto.orgId,
      projectId: dto.projectId,
      opportunityId: dto.opportunityId,
      name: `Estimate for ${dto.projectId}`,
      strategy: dto.strategy,
      laborCosts,
      materialCosts,
      travelCosts: [],
      subcontractorCosts: [],
      odcCosts: [],
      ...totals,
      margin: 10,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const result = await createCostEstimate(estimate);

    // Mirror the staffing-plan handler: surface the basis and any onshore fallbacks so the
    // UI can warn instead of silently pricing offshore-requested positions at onshore rates.
    return apiResponse(201, {
      estimate: result,
      rateBasis: basis,
      ...(onshoreFallbackPositions.length > 0 ? { onshoreFallbackPositions } : {}),
    });
  } catch (err: unknown) {
    console.error('Error in calculateEstimate handler:', err);
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
    .use(httpErrorMiddleware())
);
