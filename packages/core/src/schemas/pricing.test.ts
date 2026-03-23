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
});
