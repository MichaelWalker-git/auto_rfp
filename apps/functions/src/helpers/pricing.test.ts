import { calculateFullyLoadedRate, calculateEstimateTotals, analyzePricingForBid } from './pricing';
import type { CostEstimate } from '@auto-rfp/core';

describe('pricing helpers', () => {
  describe('calculateFullyLoadedRate', () => {
    it('should calculate correctly with standard rates', () => {
      // 50 * 1.5 (overhead 50%) = 75
      // 75 * 1.1 (G&A 10%) = 82.5
      // 82.5 * 1.1 (profit 10%) = 90.75
      const result = calculateFullyLoadedRate(50, 50, 10, 10);
      expect(result).toBe(90.75);
    });

    it('should handle zero overhead/ga/profit', () => {
      const result = calculateFullyLoadedRate(100, 0, 0, 0);
      expect(result).toBe(100);
    });

    it('should handle high overhead', () => {
      // 50 * (1 + 200/100) = 150
      // 150 * (1 + 15/100) = 172.5
      // 172.5 * (1 + 10/100) = 189.75
      const result = calculateFullyLoadedRate(50, 200, 15, 10);
      expect(result).toBe(189.75);
    });

    it('should round to 2 decimal places', () => {
      const result = calculateFullyLoadedRate(33.33, 33.33, 11.11, 7.77);
      expect(result).toBe(Math.round(result * 100) / 100);
    });
  });

  describe('calculateEstimateTotals', () => {
    it('should calculate totals correctly', () => {
      const labor = [{ totalCost: 10000 }, { totalCost: 5000 }];
      const materials = [{ totalCost: 2000 }];
      const travel = [{ totalCost: 500 }];
      const subcontractor: Array<{ totalCost: number }> = [];
      const odc = [{ totalCost: 300 }];

      const result = calculateEstimateTotals(labor, materials, travel, subcontractor, odc, 10);

      expect(result.totalDirectCost).toBe(17800);
      expect(result.totalIndirectCost).toBe(0);
      expect(result.totalCost).toBe(17800);
      expect(result.totalPrice).toBe(19580); // 17800 * 1.10
    });

    it('should handle empty arrays', () => {
      const result = calculateEstimateTotals([], [], [], [], [], 15);
      expect(result.totalDirectCost).toBe(0);
      expect(result.totalPrice).toBe(0);
    });

    it('should handle zero margin', () => {
      const labor = [{ totalCost: 1000 }];
      const result = calculateEstimateTotals(labor, [], [], [], [], 0);
      expect(result.totalPrice).toBe(1000);
    });
  });

  describe('analyzePricingForBid', () => {
    const makeEstimate = (overrides: Partial<CostEstimate> = {}): CostEstimate => ({
      estimateId: '550e8400-e29b-41d4-a716-446655440001',
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      projectId: '550e8400-e29b-41d4-a716-446655440002',
      opportunityId: '550e8400-e29b-41d4-a716-446655440003',
      name: 'Test Estimate',
      strategy: 'COST_PLUS',
      laborCosts: [{ category: 'LABOR', name: 'Engineer', quantity: 100, unitCost: 150, totalCost: 15000 }],
      materialCosts: [],
      travelCosts: [],
      subcontractorCosts: [],
      odcCosts: [],
      totalDirectCost: 15000,
      totalIndirectCost: 0,
      totalCost: 15000,
      margin: 10,
      totalPrice: 16500,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      createdBy: '550e8400-e29b-41d4-a716-446655440004',
      updatedBy: '550e8400-e29b-41d4-a716-446655440004',
      ...overrides,
    });

    it('should return COMPETITIVE position when no price-to-win', () => {
      const result = analyzePricingForBid(makeEstimate());
      expect(result.competitivePosition).toBe('COMPETITIVE');
    });

    it('should return LOW position when price is below price-to-win', () => {
      const result = analyzePricingForBid(makeEstimate({ totalPrice: 10000 }), 15000);
      expect(result.competitivePosition).toBe('LOW');
    });

    it('should return HIGH position when price is above price-to-win', () => {
      const result = analyzePricingForBid(makeEstimate({ totalPrice: 20000 }), 15000);
      expect(result.competitivePosition).toBe('HIGH');
    });

    it('should flag INSUFFICIENT margin when below 5%', () => {
      const result = analyzePricingForBid(makeEstimate({ margin: 3 }));
      expect(result.marginAdequacy).toBe('INSUFFICIENT');
      expect(result.pricingRisks).toContain('Profit margin below 5% — risk of loss on cost overruns');
    });

    it('should flag MARGINAL margin when between 5-10%', () => {
      const result = analyzePricingForBid(makeEstimate({ margin: 7 }));
      expect(result.marginAdequacy).toBe('MARGINAL');
    });

    it('should flag ADEQUATE margin when above 10%', () => {
      const result = analyzePricingForBid(makeEstimate({ margin: 15 }));
      expect(result.marginAdequacy).toBe('ADEQUATE');
    });

    it('should include scoring impact', () => {
      const result = analyzePricingForBid(makeEstimate());
      expect(result.scoringImpact).toBeDefined();
      expect(result.scoringImpact.pricingPositionScore).toBeGreaterThanOrEqual(1);
      expect(result.scoringImpact.pricingPositionScore).toBeLessThanOrEqual(5);
      expect(result.scoringImpact.justification).toBeTruthy();
    });

    it('should add fixed-price risk for FIXED_PRICE strategy', () => {
      const result = analyzePricingForBid(makeEstimate({ strategy: 'FIXED_PRICE' }));
      expect(result.pricingRisks).toContain('Fixed-price contract carries risk of cost overruns');
    });

    it('should add cost-plus advantage for COST_PLUS strategy', () => {
      const result = analyzePricingForBid(makeEstimate({ strategy: 'COST_PLUS' }));
      expect(result.competitiveAdvantages).toContain('Cost-plus pricing provides transparency and cost realism');
    });
  });
});
