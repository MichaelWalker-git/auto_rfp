import { LABOR_RATE_PK, BOM_ITEM_PK, STAFFING_PLAN_PK, COST_ESTIMATE_PK } from '@/constants/pricing';
import { createItem, putItem, getItem, queryBySkPrefix, deleteItem } from '@/helpers/db';
import type {
  LaborRate,
  BOMItem,
  StaffingPlan,
  CostEstimate,
  PricingBidAnalysis,
} from '@auto-rfp/core';

// ─── SK Builders ───

export const createLaborRateSK = (orgId: string, position: string): string =>
  `${orgId}#${position}`;

export const createBOMItemSK = (orgId: string, category: string, bomItemId: string): string =>
  `${orgId}#${category}#${bomItemId}`;

export const createStaffingPlanSK = (orgId: string, projectId: string, opportunityId: string, staffingPlanId: string): string =>
  `${orgId}#${projectId}#${opportunityId}#${staffingPlanId}`;

export const createCostEstimateSK = (orgId: string, projectId: string, opportunityId: string, estimateId: string): string =>
  `${orgId}#${projectId}#${opportunityId}#${estimateId}`;

// ─── Labor Rate DynamoDB Helpers ───

export const createLaborRate = async (laborRate: LaborRate): Promise<LaborRate> => {
  const sk = createLaborRateSK(laborRate.orgId, laborRate.position);
  await createItem(LABOR_RATE_PK, sk, laborRate);
  return laborRate;
};

export const updateLaborRate = async (laborRate: LaborRate): Promise<LaborRate> => {
  const sk = createLaborRateSK(laborRate.orgId, laborRate.position);
  await putItem(LABOR_RATE_PK, sk, laborRate);
  return laborRate;
};

export const getLaborRatesByOrg = async (orgId: string): Promise<LaborRate[]> => {
  const items = await queryBySkPrefix(LABOR_RATE_PK, `${orgId}#`);
  return items as LaborRate[];
};

export const getLaborRate = async (orgId: string, position: string): Promise<LaborRate | null> => {
  const sk = createLaborRateSK(orgId, position);
  const item = await getItem<LaborRate>(LABOR_RATE_PK, sk);
  return item ?? null;
};

export const deleteLaborRate = async (orgId: string, position: string): Promise<void> => {
  const sk = createLaborRateSK(orgId, position);
  await deleteItem(LABOR_RATE_PK, sk);
};

// ─── BOM Item DynamoDB Helpers ───

export const createBOMItem = async (bomItem: BOMItem): Promise<BOMItem> => {
  const sk = createBOMItemSK(bomItem.orgId, bomItem.category, bomItem.bomItemId);
  await createItem(BOM_ITEM_PK, sk, bomItem);
  return bomItem;
};

export const updateBOMItem = async (bomItem: BOMItem): Promise<BOMItem> => {
  const sk = createBOMItemSK(bomItem.orgId, bomItem.category, bomItem.bomItemId);
  await putItem(BOM_ITEM_PK, sk, bomItem);
  return bomItem;
};

export const getBOMItemsByOrg = async (orgId: string, category?: string): Promise<BOMItem[]> => {
  const skPrefix = category ? `${orgId}#${category}#` : `${orgId}#`;
  const items = await queryBySkPrefix(BOM_ITEM_PK, skPrefix);
  return items as BOMItem[];
};

export const getBOMItem = async (orgId: string, category: string, bomItemId: string): Promise<BOMItem | null> => {
  const sk = createBOMItemSK(orgId, category, bomItemId);
  const item = await getItem<BOMItem>(BOM_ITEM_PK, sk);
  return item ?? null;
};

export const deleteBOMItem = async (orgId: string, category: string, bomItemId: string): Promise<void> => {
  const sk = createBOMItemSK(orgId, category, bomItemId);
  await deleteItem(BOM_ITEM_PK, sk);
};

// ─── Staffing Plan DynamoDB Helpers ───

export const createStaffingPlanRecord = async (plan: StaffingPlan): Promise<StaffingPlan> => {
  const sk = createStaffingPlanSK(plan.orgId, plan.projectId, plan.opportunityId, plan.staffingPlanId);
  await createItem(STAFFING_PLAN_PK, sk, plan);
  return plan;
};

export const updateStaffingPlanRecord = async (plan: StaffingPlan): Promise<StaffingPlan> => {
  const sk = createStaffingPlanSK(plan.orgId, plan.projectId, plan.opportunityId, plan.staffingPlanId);
  await putItem(STAFFING_PLAN_PK, sk, plan);
  return plan;
};

export const getStaffingPlansByOpportunity = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
): Promise<StaffingPlan[]> => {
  const items = await queryBySkPrefix(STAFFING_PLAN_PK, `${orgId}#${projectId}#${opportunityId}#`);
  return items as StaffingPlan[];
};

export const getStaffingPlansByProject = async (
  orgId: string,
  projectId: string,
): Promise<StaffingPlan[]> => {
  const items = await queryBySkPrefix(STAFFING_PLAN_PK, `${orgId}#${projectId}#`);
  return items as StaffingPlan[];
};

export const deleteStaffingPlan = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  staffingPlanId: string,
): Promise<void> => {
  const sk = createStaffingPlanSK(orgId, projectId, opportunityId, staffingPlanId);
  await deleteItem(STAFFING_PLAN_PK, sk);
};

// ─── Cost Estimate DynamoDB Helpers ───

export const createCostEstimate = async (estimate: CostEstimate): Promise<CostEstimate> => {
  const sk = createCostEstimateSK(estimate.orgId, estimate.projectId, estimate.opportunityId, estimate.estimateId);
  await createItem(COST_ESTIMATE_PK, sk, estimate);
  return estimate;
};

export const updateCostEstimate = async (estimate: CostEstimate): Promise<CostEstimate> => {
  const sk = createCostEstimateSK(estimate.orgId, estimate.projectId, estimate.opportunityId, estimate.estimateId);
  await putItem(COST_ESTIMATE_PK, sk, estimate);
  return estimate;
};

export const getCostEstimatesByOpportunity = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
): Promise<CostEstimate[]> => {
  const items = await queryBySkPrefix(COST_ESTIMATE_PK, `${orgId}#${projectId}#${opportunityId}#`);
  return items as CostEstimate[];
};

export const getCostEstimateByOpportunity = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
): Promise<CostEstimate | null> => {
  const items = await queryBySkPrefix(COST_ESTIMATE_PK, `${orgId}#${projectId}#${opportunityId}#`);
  return items.length > 0 ? (items[0] as CostEstimate) : null;
};

export const getCostEstimateById = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  estimateId: string,
): Promise<CostEstimate | null> => {
  const sk = createCostEstimateSK(orgId, projectId, opportunityId, estimateId);
  const item = await getItem<CostEstimate>(COST_ESTIMATE_PK, sk);
  return item ?? null;
};

export const deleteCostEstimate = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  estimateId: string,
): Promise<void> => {
  const sk = createCostEstimateSK(orgId, projectId, opportunityId, estimateId);
  await deleteItem(COST_ESTIMATE_PK, sk);
};

// ─── Calculation Helpers ───

export const calculateFullyLoadedRate = (baseRate: number, overhead: number, ga: number, profit: number): number => {
  const withOverhead = baseRate * (1 + overhead / 100);
  const withGA = withOverhead * (1 + ga / 100);
  const withProfit = withGA * (1 + profit / 100);
  return Math.round(withProfit * 100) / 100;
};

export const calculateEstimateTotals = (
  laborCosts: Array<{ totalCost: number }>,
  materialCosts: Array<{ totalCost: number }>,
  travelCosts: Array<{ totalCost: number }>,
  subcontractorCosts: Array<{ totalCost: number }>,
  odcCosts: Array<{ totalCost: number }>,
  margin: number,
): { totalDirectCost: number; totalIndirectCost: number; totalCost: number; totalPrice: number } => {
  const allCosts = [...laborCosts, ...materialCosts, ...travelCosts, ...subcontractorCosts, ...odcCosts];
  const totalDirectCost = allCosts.reduce((sum, item) => sum + item.totalCost, 0);
  const totalIndirectCost = 0; // Indirect costs are built into fully loaded rates
  const totalCost = totalDirectCost + totalIndirectCost;
  const totalPrice = totalCost * (1 + margin / 100);

  return {
    totalDirectCost: Math.round(totalDirectCost * 100) / 100,
    totalIndirectCost: Math.round(totalIndirectCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    totalPrice: Math.round(totalPrice * 100) / 100,
  };
};

/**
 * Build a staffing plan by resolving labor items against org labor rates.
 * Returns fully populated StaffingPlanItem[] with rates and costs.
 */
export const resolveStaffingPlanItems = async (
  orgId: string,
  laborItems: Array<{ position: string; hours: number; phase?: string }>,
): Promise<{ items: Array<{ position: string; hours: number; rate: number; totalCost: number; phase?: string }>; totalLaborCost: number }> => {
  const laborRates = await getLaborRatesByOrg(orgId);
  const rateMap = new Map(laborRates.filter(r => r.isActive).map(r => [r.position, r.fullyLoadedRate]));

  const items = laborItems.map(item => {
    const rate = rateMap.get(item.position);
    if (!rate) {
      throw new Error(`No active labor rate found for position: ${item.position}`);
    }
    const totalCost = Math.round(item.hours * rate * 100) / 100;
    return {
      position: item.position,
      hours: item.hours,
      rate,
      totalCost,
      ...(item.phase ? { phase: item.phase } : {}),
    };
  });

  const totalLaborCost = Math.round(items.reduce((sum, i) => sum + i.totalCost, 0) * 100) / 100;

  return { items, totalLaborCost };
};

/**
 * Analyze pricing for bid/no-bid decision integration.
 * Computes competitive position, margin adequacy, and scoring impact.
 */
export const analyzePricingForBid = (
  estimate: CostEstimate,
  priceToWinEstimate?: number,
): PricingBidAnalysis => {
  const { totalPrice, margin, strategy, totalDirectCost } = estimate;

  // Determine competitive position
  let competitivePosition: 'LOW' | 'COMPETITIVE' | 'HIGH' = 'COMPETITIVE';
  let priceDifference = 0;

  if (priceToWinEstimate && priceToWinEstimate > 0) {
    priceDifference = ((totalPrice - priceToWinEstimate) / priceToWinEstimate) * 100;
    if (priceDifference < -10) competitivePosition = 'LOW';
    else if (priceDifference > 10) competitivePosition = 'HIGH';
    else competitivePosition = 'COMPETITIVE';
  }

  // Determine margin adequacy
  let marginAdequacy: 'ADEQUATE' | 'MARGINAL' | 'INSUFFICIENT' = 'ADEQUATE';
  if (margin < 5) marginAdequacy = 'INSUFFICIENT';
  else if (margin < 10) marginAdequacy = 'MARGINAL';

  // Calculate price confidence (0-100)
  let priceConfidence = 50;
  if (estimate.laborCosts.length > 0) priceConfidence += 15;
  if (estimate.materialCosts.length > 0) priceConfidence += 10;
  if (priceToWinEstimate) priceConfidence += 15;
  if (margin >= 10 && margin <= 25) priceConfidence += 10;
  priceConfidence = Math.min(100, priceConfidence);

  // Build risk factors
  const pricingRisks: string[] = [];
  const competitiveAdvantages: string[] = [];
  const recommendedActions: string[] = [];

  if (marginAdequacy === 'INSUFFICIENT') {
    pricingRisks.push('Profit margin below 5% — risk of loss on cost overruns');
    recommendedActions.push('Review cost structure and identify areas for reduction');
  }
  if (marginAdequacy === 'MARGINAL') {
    pricingRisks.push('Profit margin between 5-10% — limited buffer for unexpected costs');
  }
  if (competitivePosition === 'HIGH') {
    pricingRisks.push('Price significantly above estimated price-to-win');
    recommendedActions.push('Consider value engineering or scope reduction');
  }
  if (competitivePosition === 'LOW') {
    competitiveAdvantages.push('Competitive pricing position — below estimated price-to-win');
    if (margin >= 10) {
      competitiveAdvantages.push('Healthy margin maintained despite competitive pricing');
    }
  }
  if (strategy === 'COST_PLUS') {
    competitiveAdvantages.push('Cost-plus pricing provides transparency and cost realism');
  }
  if (strategy === 'FIXED_PRICE') {
    pricingRisks.push('Fixed-price contract carries risk of cost overruns');
    recommendedActions.push('Ensure thorough basis of estimate and contingency planning');
  }

  // Calculate scoring impact (1-5 scale)
  let pricingPositionScore = 3;
  let justification = 'Competitive pricing position';

  if (competitivePosition === 'LOW' && marginAdequacy !== 'INSUFFICIENT') {
    pricingPositionScore = 5;
    justification = 'Excellent pricing — below market with adequate margins';
  } else if (competitivePosition === 'LOW' && marginAdequacy === 'INSUFFICIENT') {
    pricingPositionScore = 4;
    justification = 'Low price but insufficient margins raise sustainability concerns';
  } else if (competitivePosition === 'COMPETITIVE') {
    pricingPositionScore = marginAdequacy === 'ADEQUATE' ? 4 : 3;
    justification = 'Competitive pricing with ' + (marginAdequacy === 'ADEQUATE' ? 'healthy' : 'marginal') + ' margins';
  } else if (competitivePosition === 'HIGH') {
    pricingPositionScore = 2;
    justification = 'Above-market pricing may reduce competitiveness';
  }

  return {
    estimateId: estimate.estimateId,
    orgId: estimate.orgId,
    projectId: estimate.projectId,
    opportunityId: estimate.opportunityId,
    totalPrice,
    strategy,
    competitivePosition,
    priceToWinEstimate,
    priceConfidence,
    marginAdequacy,
    pricingRisks,
    competitiveAdvantages,
    recommendedActions,
    scoringImpact: {
      pricingPositionScore,
      justification,
    },
  };
};
