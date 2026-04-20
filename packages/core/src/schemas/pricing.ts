import { z } from 'zod';
import { ExtractionSourceSchema } from './past-performance';

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
  // Extraction source (preserved when created from AI extraction)
  extractionSource: ExtractionSourceSchema.optional().nullable(),
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
  // Extraction source (preserved when created from AI extraction)
  extractionSource: ExtractionSourceSchema.optional().nullable(),
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
 *
 * Uses z.preprocess on numeric fields because the AI may return strings
 * ("$1,000,000"), formatted numbers ("1,000,000"), null, or other non-numeric
 * values. The preprocessor strips formatting and coerces to a number,
 * defaulting to 0 when the value is unparseable.
 */

/** Coerce any AI output to a non-negative number. Handles "$1,000,000", "1.5M", null, undefined, etc. */
const coerceNumber = (v: unknown): number => {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') {
    // Strip currency symbols, commas, whitespace
    const cleaned = v.replace(/[$€£¥,\s]/g, '').trim();
    if (!cleaned || cleaned === 'N/A' || cleaned === 'n/a' || cleaned === 'TBD' || cleaned === '-') return 0;
    // Handle shorthand: 1.5M, 500K, 2B
    const shorthand = cleaned.match(/^([+-]?\d+(?:\.\d+)?)\s*([KkMmBb])?$/);
    if (shorthand) {
      const num = parseFloat(shorthand[1]);
      const suffix = (shorthand[2] ?? '').toUpperCase();
      const multiplier = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1;
      const result = num * multiplier;
      return Number.isNaN(result) ? 0 : result;
    }
    const parsed = parseFloat(cleaned);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

/** Coerce to number, then clamp to [0, max]. */
const coerceClampedNumber = (max: number) => (v: unknown): number => {
  const n = coerceNumber(v);
  return Math.max(0, Math.min(max, Math.round(n)));
};

export const PricingSectionSchema = z.object({
  estimateId: z.string().uuid().optional(),
  strategy: z.preprocess(
    (v) => {
      if (typeof v === 'string') {
        const upper = v.toUpperCase().replace(/[\s-]+/g, '_');
        const valid = ['COST_PLUS', 'FIXED_PRICE', 'TIME_AND_MATERIALS', 'COMPETITIVE_ANALYSIS'];
        if (valid.includes(upper)) return upper;
        // Fuzzy match common AI outputs
        if (upper.includes('COST') && upper.includes('PLUS')) return 'COST_PLUS';
        if (upper.includes('FIXED')) return 'FIXED_PRICE';
        if (upper.includes('TIME') || upper.includes('T&M') || upper.includes('T_M')) return 'TIME_AND_MATERIALS';
        return 'COMPETITIVE_ANALYSIS'; // Default fallback
      }
      return v ?? 'COMPETITIVE_ANALYSIS';
    },
    PricingStrategySchema,
  ),
  totalPrice: z.preprocess(coerceNumber, z.number().nonnegative()),
  competitivePosition: z.preprocess(
    (v) => {
      if (typeof v === 'string') {
        const upper = v.toUpperCase().trim();
        if (upper.includes('LOW') || upper.includes('BELOW')) return 'LOW';
        if (upper.includes('HIGH') || upper.includes('ABOVE')) return 'HIGH';
        return 'COMPETITIVE';
      }
      return v ?? 'COMPETITIVE';
    },
    z.enum(['LOW', 'COMPETITIVE', 'HIGH']),
  ),
  priceConfidence: z.preprocess(coerceClampedNumber(100), z.number().int().min(0).max(100)),

  // Summary breakdown — all coerced to nonnegative numbers (AI may return 0, null, strings, etc.)
  laborCostTotal: z.preprocess(coerceNumber, z.number().nonnegative()),
  materialCostTotal: z.preprocess(coerceNumber, z.number().nonnegative()),
  indirectCostTotal: z.preprocess(coerceNumber, z.number().nonnegative()),
  profitMargin: z.preprocess(coerceClampedNumber(100), z.number().min(0).max(100)),

  // Key insights for Bid/No-Bid — AI may return null, undefined, or non-array values
  competitiveAdvantages: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((i): i is string => typeof i === 'string') : []),
    z.array(z.string()).default([]),
  ),
  pricingRisks: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((i): i is string => typeof i === 'string') : []),
    z.array(z.string()).default([]),
  ),
  recommendedActions: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((i): i is string => typeof i === 'string') : []),
    z.array(z.string()).default([]),
  ),

  // Basis of estimate summary
  basisOfEstimate: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return 'No basis of estimate provided';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v).slice(0, 2000);
    },
    z.string().max(2000),
  ),
  assumptions: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((i): i is string => typeof i === 'string') : []),
    z.array(z.string()).default([]),
  ),
}).passthrough(); // Allow extra fields from AI without failing validation

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
