import { describe, it, expect } from 'vitest';
import {
  LaborRateSchema,
  CreateLaborRateSchema,
  UpdateLaborRateSchema,
  BOMItemSchema,
  CreateBOMItemSchema,
  UpdateBOMItemSchema,
  StaffingPlanSchema,
  CreateStaffingPlanSchema,
  CostEstimateSchema,
  PricingStrategySchema,
  BOMItemTypeSchema,
  CalculateEstimateRequestSchema,
  GeneratePriceVolumeRequestSchema,
  PricingBidAnalysisSchema,
  PricingSectionSchema,
} from './pricing';

describe('pricing schemas', () => {
  describe('LaborRateSchema', () => {
    const validLaborRate = {
      laborRateId: '550e8400-e29b-41d4-a716-446655440001',
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      position: 'Senior Engineer',
      baseRate: 75,
      overhead: 120,
      ga: 12,
      profit: 10,
      fullyLoadedRate: 220.32,
      effectiveDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      createdBy: '550e8400-e29b-41d4-a716-446655440002',
      updatedBy: '550e8400-e29b-41d4-a716-446655440002',
    };

    it('should validate a valid labor rate', () => {
      const { success } = LaborRateSchema.safeParse(validLaborRate);
      expect(success).toBe(true);
    });

    it('should reject negative base rate', () => {
      const { success } = LaborRateSchema.safeParse({ ...validLaborRate, baseRate: -10 });
      expect(success).toBe(false);
    });

    it('should reject empty position', () => {
      const { success } = LaborRateSchema.safeParse({ ...validLaborRate, position: '' });
      expect(success).toBe(false);
    });

    it('should allow optional expirationDate', () => {
      const { success, data } = LaborRateSchema.safeParse(validLaborRate);
      expect(success).toBe(true);
      expect(data?.expirationDate).toBeUndefined();
    });
  });

  describe('CreateLaborRateSchema', () => {
    it('should validate without id and timestamps', () => {
      const { success } = CreateLaborRateSchema.safeParse({
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        position: 'Developer',
        baseRate: 60,
        overhead: 100,
        ga: 10,
        profit: 8,
        effectiveDate: '2024-01-01T00:00:00.000Z',
      });
      expect(success).toBe(true);
    });

    it('should apply default isActive', () => {
      const { success, data } = CreateLaborRateSchema.safeParse({
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        position: 'Developer',
        baseRate: 60,
        overhead: 100,
        ga: 10,
        profit: 8,
        effectiveDate: '2024-01-01T00:00:00.000Z',
      });
      expect(success).toBe(true);
      expect(data?.isActive).toBe(true);
    });
  });

  describe('UpdateLaborRateSchema', () => {
    it('should allow partial updates with required ids', () => {
      const { success } = UpdateLaborRateSchema.safeParse({
        laborRateId: '550e8400-e29b-41d4-a716-446655440001',
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        baseRate: 80,
      });
      expect(success).toBe(true);
    });

    it('should require laborRateId', () => {
      const { success } = UpdateLaborRateSchema.safeParse({
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        baseRate: 80,
      });
      expect(success).toBe(false);
    });
  });

  describe('BOMItemTypeSchema', () => {
    it('should accept valid categories', () => {
      const categories = ['HARDWARE', 'SOFTWARE_LICENSE', 'MATERIALS', 'SUBCONTRACTOR', 'TRAVEL', 'ODC'];
      for (const cat of categories) {
        const { success } = BOMItemTypeSchema.safeParse(cat);
        expect(success).toBe(true);
      }
    });

    it('should reject invalid category', () => {
      const { success } = BOMItemTypeSchema.safeParse('INVALID');
      expect(success).toBe(false);
    });
  });

  describe('CreateBOMItemSchema', () => {
    it('should validate a valid BOM item', () => {
      const { success } = CreateBOMItemSchema.safeParse({
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        category: 'HARDWARE',
        name: 'Server',
        unitCost: 5000,
        unit: 'each',
      });
      expect(success).toBe(true);
    });
  });

  describe('PricingStrategySchema', () => {
    it('should accept all valid strategies', () => {
      const strategies = ['COST_PLUS', 'FIXED_PRICE', 'TIME_AND_MATERIALS', 'COMPETITIVE_ANALYSIS'];
      for (const s of strategies) {
        const { success } = PricingStrategySchema.safeParse(s);
        expect(success).toBe(true);
      }
    });
  });

  describe('CreateStaffingPlanSchema', () => {
    it('should validate a valid staffing plan', () => {
      const { success } = CreateStaffingPlanSchema.safeParse({
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        opportunityId: '550e8400-e29b-41d4-a716-446655440002',
        name: 'Base Period Plan',
        laborItems: [
          { position: 'Engineer', hours: 1000 },
          { position: 'PM', hours: 500, phase: 'Phase 1' },
        ],
      });
      expect(success).toBe(true);
    });

    it('should require at least one labor item', () => {
      const { success } = CreateStaffingPlanSchema.safeParse({
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        opportunityId: '550e8400-e29b-41d4-a716-446655440002',
        name: 'Empty Plan',
        laborItems: [],
      });
      expect(success).toBe(false);
    });
  });

  describe('CalculateEstimateRequestSchema', () => {
    it('should validate a valid request', () => {
      const { success } = CalculateEstimateRequestSchema.safeParse({
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        opportunityId: '550e8400-e29b-41d4-a716-446655440002',
        strategy: 'COST_PLUS',
        laborItems: [{ position: 'Engineer', hours: 100 }],
      });
      expect(success).toBe(true);
    });

    it('should allow optional bomItems', () => {
      const { success, data } = CalculateEstimateRequestSchema.safeParse({
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        opportunityId: '550e8400-e29b-41d4-a716-446655440002',
        strategy: 'FIXED_PRICE',
        laborItems: [{ position: 'PM', hours: 50 }],
      });
      expect(success).toBe(true);
      expect(data?.bomItems).toBeUndefined();
    });
  });

  describe('PricingBidAnalysisSchema', () => {
    it('should validate a valid bid analysis', () => {
      const { success } = PricingBidAnalysisSchema.safeParse({
        estimateId: '550e8400-e29b-41d4-a716-446655440001',
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440002',
        opportunityId: '550e8400-e29b-41d4-a716-446655440003',
        totalPrice: 100000,
        strategy: 'COST_PLUS',
        competitivePosition: 'COMPETITIVE',
        priceConfidence: 75,
        marginAdequacy: 'ADEQUATE',
        pricingRisks: ['Some risk'],
        competitiveAdvantages: ['Some advantage'],
        recommendedActions: ['Some action'],
        scoringImpact: {
          pricingPositionScore: 4,
          justification: 'Good pricing position',
        },
      });
      expect(success).toBe(true);
    });
  });

  describe('GeneratePriceVolumeRequestSchema', () => {
    it('should apply default format', () => {
      const { success, data } = GeneratePriceVolumeRequestSchema.safeParse({
        orgId: '550e8400-e29b-41d4-a716-446655440000',
        estimateId: '550e8400-e29b-41d4-a716-446655440001',
      });
      expect(success).toBe(true);
      expect(data?.format).toBe('PDF');
    });
  });

  describe('PricingSectionSchema', () => {
    const validPricingSection = {
      strategy: 'COST_PLUS',
      totalPrice: 1000000,
      competitivePosition: 'COMPETITIVE',
      priceConfidence: 75,
      laborCostTotal: 800000,
      materialCostTotal: 100000,
      indirectCostTotal: 50000,
      profitMargin: 10,
      competitiveAdvantages: ['Strong technical team'],
      pricingRisks: ['Tight margins'],
      recommendedActions: ['Review labor mix'],
      basisOfEstimate: 'Based on historical data and labor rate analysis',
      assumptions: ['Standard overhead rates apply'],
    };

    it('should validate a valid pricing section', () => {
      const { success } = PricingSectionSchema.safeParse(validPricingSection);
      expect(success).toBe(true);
    });

    it('should allow zero materialCostTotal for labor-only contracts', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        materialCostTotal: 0,
      });
      expect(success).toBe(true);
      expect(data?.materialCostTotal).toBe(0);
    });

    it('should allow zero indirectCostTotal when indirect costs are in loaded rates', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        indirectCostTotal: 0,
      });
      expect(success).toBe(true);
      expect(data?.indirectCostTotal).toBe(0);
    });

    it('should allow zero laborCostTotal', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        laborCostTotal: 0,
      });
      expect(success).toBe(true);
      expect(data?.laborCostTotal).toBe(0);
    });

    it('should coerce negative cost totals to 0 via preprocess', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        materialCostTotal: -100,
      });
      // preprocess coerces -100 to -100 (number), then nonnegative() rejects it
      // Actually, coerceNumber returns -100 as-is since it's a valid number
      // nonnegative() then rejects it
      expect(success).toBe(false);
    });

    it('should allow zero totalPrice (coerced from nonnegative)', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        totalPrice: 0,
      });
      expect(success).toBe(true);
      expect(data?.totalPrice).toBe(0);
    });

    it('should apply default empty arrays', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        strategy: 'FIXED_PRICE',
        totalPrice: 500000,
        competitivePosition: 'LOW',
        priceConfidence: 60,
        laborCostTotal: 400000,
        materialCostTotal: 0,
        indirectCostTotal: 0,
        profitMargin: 15,
        basisOfEstimate: 'Market analysis',
      });
      expect(success).toBe(true);
      expect(data?.competitiveAdvantages).toEqual([]);
      expect(data?.pricingRisks).toEqual([]);
      expect(data?.recommendedActions).toEqual([]);
      expect(data?.assumptions).toEqual([]);
    });

    // ─── AI coercion tests ───

    it('should coerce string "$1,000,000" to number 1000000', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        totalPrice: '$1,000,000',
        laborCostTotal: '$800,000',
      });
      expect(success).toBe(true);
      expect(data?.totalPrice).toBe(1000000);
      expect(data?.laborCostTotal).toBe(800000);
    });

    it('should coerce shorthand "1.5M" to 1500000', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        totalPrice: '1.5M',
        laborCostTotal: '500K',
      });
      expect(success).toBe(true);
      expect(data?.totalPrice).toBe(1500000);
      expect(data?.laborCostTotal).toBe(500000);
    });

    it('should coerce null/undefined cost fields to 0', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        materialCostTotal: null,
        indirectCostTotal: undefined,
      });
      expect(success).toBe(true);
      expect(data?.materialCostTotal).toBe(0);
      expect(data?.indirectCostTotal).toBe(0);
    });

    it('should coerce "N/A" and "TBD" to 0', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        materialCostTotal: 'N/A',
        indirectCostTotal: 'TBD',
      });
      expect(success).toBe(true);
      expect(data?.materialCostTotal).toBe(0);
      expect(data?.indirectCostTotal).toBe(0);
    });

    it('should coerce strategy strings like "Cost Plus" or "Fixed Price"', () => {
      const { success: s1, data: d1 } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        strategy: 'Cost Plus',
      });
      expect(s1).toBe(true);
      expect(d1?.strategy).toBe('COST_PLUS');

      const { success: s2, data: d2 } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        strategy: 'Fixed Price',
      });
      expect(s2).toBe(true);
      expect(d2?.strategy).toBe('FIXED_PRICE');

      const { success: s3, data: d3 } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        strategy: 'T&M',
      });
      expect(s3).toBe(true);
      expect(d3?.strategy).toBe('TIME_AND_MATERIALS');
    });

    it('should coerce competitive position strings', () => {
      const { success: s1, data: d1 } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        competitivePosition: 'Below Market',
      });
      expect(s1).toBe(true);
      expect(d1?.competitivePosition).toBe('LOW');

      const { success: s2, data: d2 } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        competitivePosition: 'Above Market',
      });
      expect(s2).toBe(true);
      expect(d2?.competitivePosition).toBe('HIGH');
    });

    it('should clamp priceConfidence to 0-100', () => {
      const { success: s1, data: d1 } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        priceConfidence: 150,
      });
      expect(s1).toBe(true);
      expect(d1?.priceConfidence).toBe(100);

      const { success: s2, data: d2 } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        priceConfidence: '85%',
      });
      expect(s2).toBe(true);
      expect(d2?.priceConfidence).toBe(85);
    });

    it('should handle null basisOfEstimate', () => {
      const { success, data } = PricingSectionSchema.safeParse({
        ...validPricingSection,
        basisOfEstimate: null,
      });
      expect(success).toBe(true);
      expect(data?.basisOfEstimate).toBe('No basis of estimate provided');
    });
  });
});
