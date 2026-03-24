import { z } from 'zod';

/**
 * ================
 * LABOR RATES
 * ================
 */
export const LaborRateSchema = z.object({
  laborRateId: z.string().uuid(),
  orgId: z.string().uuid(),
  position: z.string().min(1).max(100), // e.g., "Senior Engineer"
  baseRate: z.number().positive(), // Hourly rate
  overhead: z.number().min(0).max(500), // Percentage (e.g., 150.5 for 150.5%)
  ga: z.number().min(0).max(100), // G&A percentage
  profit: z.number().min(0).max(100), // Profit margin percentage
  fullyLoadedRate: z.number().positive(), // Final billable rate (calculated)
  effectiveDate: z.string().datetime(),
  expirationDate: z.string().datetime().optional(),
  isActive: z.boolean().default(true),
  rateJustification: z.string().max(500).optional(), // GSA schedule, market research, etc.
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
});

export type LaborRate = z.infer<typeof LaborRateSchema>;

export const CreateLaborRateSchema = LaborRateSchema.omit({
  laborRateId: true,
  fullyLoadedRate: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
});

export type CreateLaborRate = z.infer<typeof CreateLaborRateSchema>;

export const UpdateLaborRateSchema = CreateLaborRateSchema.partial().extend({
  laborRateId: z.string().uuid(),
  orgId: z.string().uuid(),
});

export type UpdateLaborRate = z.infer<typeof UpdateLaborRateSchema>;

/**
 * ================
 * BOM ITEMS
 * ================
 */
export const BOMItemTypeSchema = z.enum([
  'HARDWARE',
  'SOFTWARE_LICENSE',
  'MATERIALS',
  'SUBCONTRACTOR',
  'TRAVEL',
  'ODC', // Other Direct Costs
]);

export const BOMItemSchema = z.object({
  bomItemId: z.string().uuid(),
  orgId: z.string().uuid(),
  category: BOMItemTypeSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  unitCost: z.number().positive(),
  unit: z.string().min(1).max(50), // "each", "license", "month", "trip"
  vendor: z.string().max(200).optional(),
  partNumber: z.string().max(100).optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
});

export type BOMItem = z.infer<typeof BOMItemSchema>;

export const CreateBOMItemSchema = BOMItemSchema.omit({
  bomItemId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
});

export type CreateBOMItem = z.infer<typeof CreateBOMItemSchema>;

export const UpdateBOMItemSchema = CreateBOMItemSchema.partial().extend({
  bomItemId: z.string().uuid(),
  orgId: z.string().uuid(),
});

export type UpdateBOMItem = z.infer<typeof UpdateBOMItemSchema>;

/**
 * ================
 * STAFFING PLAN
 * ================
 */
export const StaffingPlanItemSchema = z.object({
  position: z.string().min(1).max(100), // Must match LaborRate.position
  hours: z.number().positive(),
  rate: z.number().positive(), // From LaborRate.fullyLoadedRate
  totalCost: z.number().positive(), // hours * rate
  phase: z.string().max(100).optional(), // "Phase 1", "Base Period", etc.
});

export const StaffingPlanSchema = z.object({
  staffingPlanId: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  name: z.string().min(1).max(200),
  laborItems: z.array(StaffingPlanItemSchema).min(1),
  totalLaborCost: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
});

export type StaffingPlan = z.infer<typeof StaffingPlanSchema>;

export const CreateStaffingPlanSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  name: z.string().min(1).max(200),
  laborItems: z.array(z.object({
    position: z.string().min(1).max(100),
    hours: z.number().positive(),
    phase: z.string().max(100).optional(),
  })).min(1),
});

export type CreateStaffingPlan = z.infer<typeof CreateStaffingPlanSchema>;

export const UpdateStaffingPlanSchema = CreateStaffingPlanSchema.partial().extend({
  staffingPlanId: z.string().uuid(),
  orgId: z.string().uuid(),
});

export type UpdateStaffingPlan = z.infer<typeof UpdateStaffingPlanSchema>;

export type StaffingPlanItem = z.infer<typeof StaffingPlanItemSchema>;

/**
 * ================
 * COST ESTIMATE
 * ================
 */
export const PricingStrategySchema = z.enum([
  'COST_PLUS',
  'FIXED_PRICE',
  'TIME_AND_MATERIALS',
  'COMPETITIVE_ANALYSIS',
]);

export const EstimateItemSchema = z.object({
  category: z.enum(['LABOR', 'HARDWARE', 'SOFTWARE', 'MATERIALS', 'SUBCONTRACTOR', 'TRAVEL', 'ODC']),
  name: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unitCost: z.number().positive(),
  totalCost: z.number().positive(),
  phase: z.string().max(100).optional(),
});

export const CostEstimateSchema = z.object({
  estimateId: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  name: z.string().min(1).max(200),
  strategy: PricingStrategySchema,
  
  // Cost breakdown
  laborCosts: z.array(EstimateItemSchema),
  materialCosts: z.array(EstimateItemSchema),
  travelCosts: z.array(EstimateItemSchema),
  subcontractorCosts: z.array(EstimateItemSchema),
  odcCosts: z.array(EstimateItemSchema),
  
  // Totals
  totalDirectCost: z.number().positive(),
  totalIndirectCost: z.number().positive(),
  totalCost: z.number().positive(),
  margin: z.number().min(0).max(100), // Profit margin percentage
  totalPrice: z.number().positive(),
  
  // Competitive analysis
  competitivePosition: z.enum(['LOW', 'COMPETITIVE', 'HIGH']).optional(),
  historicalComparison: z.string().max(1000).optional(),
  
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
});

export type CostEstimate = z.infer<typeof CostEstimateSchema>;

/**
 * ================
 * PRICING SECTION (for Executive Brief)
 * ================
 */
export const PricingSectionSchema = z.object({
  estimateId: z.string().uuid().optional(),
  strategy: PricingStrategySchema,
  totalPrice: z.number().positive(),
  competitivePosition: z.enum(['LOW', 'COMPETITIVE', 'HIGH']),
  priceConfidence: z.number().int().min(0).max(100),
  
  // Summary breakdown
  laborCostTotal: z.number().nonnegative(),
  materialCostTotal: z.number().nonnegative(),
  indirectCostTotal: z.number().nonnegative(),
  profitMargin: z.number().min(0).max(100),
  
  // Key insights for Bid/No-Bid
  competitiveAdvantages: z.array(z.string()).default([]),
  pricingRisks: z.array(z.string()).default([]),
  recommendedActions: z.array(z.string()).default([]),
  
  // Basis of estimate summary
  basisOfEstimate: z.string().max(2000),
  assumptions: z.array(z.string()).default([]),
});

export type PricingSection = z.infer<typeof PricingSectionSchema>;

/**
 * ================
 * REQUEST/RESPONSE SCHEMAS
 * ================
 */
export const CalculateEstimateRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  strategy: PricingStrategySchema,
  laborItems: z.array(z.object({
    position: z.string().min(1),
    hours: z.number().positive(),
  })),
  bomItems: z.array(z.object({
    bomItemId: z.string().uuid(),
    quantity: z.number().positive(),
  })).optional(),
});

export type CalculateEstimateRequest = z.infer<typeof CalculateEstimateRequestSchema>;

export const GeneratePriceVolumeRequestSchema = z.object({
  orgId: z.string().uuid(),
  estimateId: z.string().uuid(),
  format: z.enum(['PDF', 'DOCX', 'XLSX']).default('PDF'),
});

export type GeneratePriceVolumeRequest = z.infer<typeof GeneratePriceVolumeRequestSchema>;

export type EstimateItem = z.infer<typeof EstimateItemSchema>;
export type PricingStrategy = z.infer<typeof PricingStrategySchema>;
export type BOMItemType = z.infer<typeof BOMItemTypeSchema>;

/**
 * ================
 * BID/NO-BID PRICING INTEGRATION
 * ================
 */
export const PricingBidAnalysisSchema = z.object({
  estimateId: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),

  // Pricing summary
  totalPrice: z.number().nonnegative(),
  strategy: PricingStrategySchema,
  competitivePosition: z.enum(['LOW', 'COMPETITIVE', 'HIGH']),

  // Bid/No-Bid factors
  priceToWinEstimate: z.number().nonnegative().optional(),
  priceConfidence: z.number().int().min(0).max(100),
  marginAdequacy: z.enum(['ADEQUATE', 'MARGINAL', 'INSUFFICIENT']),

  // Risk factors
  pricingRisks: z.array(z.string()),
  competitiveAdvantages: z.array(z.string()),
  recommendedActions: z.array(z.string()),

  // Scoring impact
  scoringImpact: z.object({
    pricingPositionScore: z.number().min(1).max(5),
    justification: z.string().max(500),
  }),
});

export type PricingBidAnalysis = z.infer<typeof PricingBidAnalysisSchema>;

/**
 * ================
 * API RESPONSE TYPES
 * ================
 */
export interface LaborRatesResponse {
  laborRates: LaborRate[];
}

export interface LaborRateResponse {
  laborRate: LaborRate;
}

export interface BOMItemsResponse {
  bomItems: BOMItem[];
}

export interface BOMItemResponse {
  bomItem: BOMItem;
}

export interface StaffingPlansResponse {
  staffingPlans: StaffingPlan[];
}

export interface StaffingPlanResponse {
  staffingPlan: StaffingPlan;
}

export interface CostEstimateResponse {
  estimate: CostEstimate;
}

export interface CostEstimatesResponse {
  estimates: CostEstimate[];
}

export interface PricingBidAnalysisResponse {
  analysis: PricingBidAnalysis;
}

export interface ExportPricingResponse {
  downloadUrl: string;
  format: string;
  expiresAt: string;
}
