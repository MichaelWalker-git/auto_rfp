import { PK_NAME, SK_NAME } from '@/constants/common';
import { LABOR_RATE_PK, BOM_ITEM_PK, STAFFING_PLAN_PK, COST_ESTIMATE_PK } from '@/constants/pricing';
import { createItem, putItem, getItem, queryBySkPrefix, deleteItem } from '@/helpers/db';
import type { LaborRate, BOMItem, StaffingPlan, CostEstimate } from '@auto-rfp/core';

// ─── SK Builders ───

export const createLaborRateSK = (orgId: string, position: string): string => 
  `${orgId}#${position}`;

export const createBOMItemSK = (orgId: string, category: string, bomItemId: string): string => 
  `${orgId}#${category}#${bomItemId}`;

export const createStaffingPlanSK = (orgId: string, projectId: string, opportunityId: string, staffingPlanId: string): string => 
  `${orgId}#${projectId}#${opportunityId}#${staffingPlanId}`;

export const createCostEstimateSK = (orgId: string, projectId: string, opportunityId: string, estimateId: string): string => 
  `${orgId}#${projectId}#${opportunityId}#${estimateId}`;

// ─── DynamoDB Helpers ───

export const createLaborRate = async (laborRate: LaborRate): Promise<LaborRate> => {
  const sk = createLaborRateSK(laborRate.orgId, laborRate.position);
  await createItem(LABOR_RATE_PK, sk, laborRate);
  return laborRate;
};

export const getLaborRatesByOrg = async (orgId: string): Promise<LaborRate[]> => {
  const items = await queryBySkPrefix(LABOR_RATE_PK, `${orgId}#`);
  return items as LaborRate[];
};

export const createBOMItem = async (bomItem: BOMItem): Promise<BOMItem> => {
  const sk = createBOMItemSK(bomItem.orgId, bomItem.category, bomItem.bomItemId);
  await createItem(BOM_ITEM_PK, sk, bomItem);
  return bomItem;
};

export const getBOMItemsByOrg = async (orgId: string, category?: string): Promise<BOMItem[]> => {
  const skPrefix = category ? `${orgId}#${category}#` : `${orgId}#`;
  const items = await queryBySkPrefix(BOM_ITEM_PK, skPrefix);
  return items as BOMItem[];
};

export const createCostEstimate = async (estimate: CostEstimate): Promise<CostEstimate> => {
  const sk = createCostEstimateSK(estimate.orgId, estimate.projectId, estimate.opportunityId, estimate.estimateId);
  await createItem(COST_ESTIMATE_PK, sk, estimate);
  return estimate;
};

export const getCostEstimateByOpportunity = async (
  orgId: string, 
  projectId: string, 
  opportunityId: string
): Promise<CostEstimate | null> => {
  const items = await queryBySkPrefix(COST_ESTIMATE_PK, `${orgId}#${projectId}#${opportunityId}#`);
  return items.length > 0 ? (items[0] as CostEstimate) : null;
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
  margin: number
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