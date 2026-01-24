/**
 * Unit tests for executive-opportunity-brief.ts schema
 *
 * Related Sentry Issues:
 * - AUTO-RFP-5Q: ZodError for contract type enum (FIRM_FIXED_PRICE not in enum)
 */

import {
  normalizeContractType,
  normalizeSetAside,
  QuickSummarySchema,
} from './executive-opportunity-brief';

describe('normalizeContractType', () => {
  describe('AUTO-RFP-5Q regression: full names to abbreviations', () => {
    it('should normalize FIRM_FIXED_PRICE to FFP', () => {
      expect(normalizeContractType('FIRM_FIXED_PRICE')).toBe('FFP');
    });

    it('should normalize FIRM-FIXED-PRICE to FFP', () => {
      expect(normalizeContractType('FIRM-FIXED-PRICE')).toBe('FFP');
    });

    it('should normalize FIXED_PRICE to FFP', () => {
      expect(normalizeContractType('FIXED_PRICE')).toBe('FFP');
    });

    it('should normalize TIME_AND_MATERIALS to T&M', () => {
      expect(normalizeContractType('TIME_AND_MATERIALS')).toBe('T&M');
    });

    it('should normalize TIME-AND-MATERIALS to T&M', () => {
      expect(normalizeContractType('TIME-AND-MATERIALS')).toBe('T&M');
    });

    it('should normalize COST_PLUS_FIXED_FEE to COST_PLUS', () => {
      expect(normalizeContractType('COST_PLUS_FIXED_FEE')).toBe('COST_PLUS');
    });

    it('should normalize COST_REIMBURSEMENT to COST_PLUS', () => {
      expect(normalizeContractType('COST_REIMBURSEMENT')).toBe('COST_PLUS');
    });

    it('should normalize INDEFINITE_DELIVERY_INDEFINITE_QUANTITY to IDIQ', () => {
      expect(normalizeContractType('INDEFINITE_DELIVERY_INDEFINITE_QUANTITY')).toBe('IDIQ');
    });

    it('should normalize BLANKET_PURCHASE_AGREEMENT to BPA', () => {
      expect(normalizeContractType('BLANKET_PURCHASE_AGREEMENT')).toBe('BPA');
    });

    it('should normalize GSA_SCHEDULE to SCHEDULE', () => {
      expect(normalizeContractType('GSA_SCHEDULE')).toBe('SCHEDULE');
    });

    it('should normalize FSS to SCHEDULE', () => {
      expect(normalizeContractType('FSS')).toBe('SCHEDULE');
    });
  });

  describe('already normalized values', () => {
    it('should pass through FFP unchanged', () => {
      expect(normalizeContractType('FFP')).toBe('FFP');
    });

    it('should pass through T&M unchanged', () => {
      expect(normalizeContractType('T&M')).toBe('T&M');
    });

    it('should pass through IDIQ unchanged', () => {
      expect(normalizeContractType('IDIQ')).toBe('IDIQ');
    });

    it('should pass through UNKNOWN unchanged', () => {
      expect(normalizeContractType('UNKNOWN')).toBe('UNKNOWN');
    });

    it('should pass through OTHER unchanged', () => {
      expect(normalizeContractType('OTHER')).toBe('OTHER');
    });
  });

  describe('case insensitivity', () => {
    it('should normalize lowercase firm_fixed_price', () => {
      expect(normalizeContractType('firm_fixed_price')).toBe('FFP');
    });

    it('should normalize mixed case Firm_Fixed_Price', () => {
      expect(normalizeContractType('Firm_Fixed_Price')).toBe('FFP');
    });
  });

  describe('edge cases', () => {
    it('should return UNKNOWN for non-string values', () => {
      expect(normalizeContractType(null)).toBe('UNKNOWN');
      expect(normalizeContractType(undefined)).toBe('UNKNOWN');
      expect(normalizeContractType(123)).toBe('UNKNOWN');
      expect(normalizeContractType({})).toBe('UNKNOWN');
    });

    it('should handle whitespace', () => {
      expect(normalizeContractType('  FFP  ')).toBe('FFP');
      expect(normalizeContractType('  FIRM_FIXED_PRICE  ')).toBe('FFP');
    });

    it('should return unknown values as-is (uppercased)', () => {
      expect(normalizeContractType('CUSTOM_TYPE')).toBe('CUSTOM_TYPE');
    });
  });
});

describe('normalizeSetAside', () => {
  describe('full names to abbreviations', () => {
    it('should normalize SMALL_BUSINESS_SET_ASIDE to SMALL_BUSINESS', () => {
      expect(normalizeSetAside('SMALL_BUSINESS_SET_ASIDE')).toBe('SMALL_BUSINESS');
    });

    it('should normalize SERVICE_DISABLED_VETERAN_OWNED to SDVOSB', () => {
      expect(normalizeSetAside('SERVICE_DISABLED_VETERAN_OWNED')).toBe('SDVOSB');
    });

    it('should normalize VETERAN_OWNED to VOSB', () => {
      expect(normalizeSetAside('VETERAN_OWNED')).toBe('VOSB');
    });

    it('should normalize WOMAN_OWNED to WOSB', () => {
      expect(normalizeSetAside('WOMAN_OWNED')).toBe('WOSB');
    });

    it('should normalize WOMEN_OWNED to WOSB', () => {
      expect(normalizeSetAside('WOMEN_OWNED')).toBe('WOSB');
    });

    it('should normalize HISTORICALLY_UNDERUTILIZED to HUBZONE', () => {
      expect(normalizeSetAside('HISTORICALLY_UNDERUTILIZED')).toBe('HUBZONE');
    });

    it('should normalize 8(A) to 8A', () => {
      expect(normalizeSetAside('8(A)')).toBe('8A');
    });

    it('should normalize FULL_AND_OPEN to NONE', () => {
      expect(normalizeSetAside('FULL_AND_OPEN')).toBe('NONE');
    });

    it('should normalize N/A to NONE', () => {
      expect(normalizeSetAside('N/A')).toBe('NONE');
    });
  });

  describe('already normalized values', () => {
    it('should pass through SMALL_BUSINESS unchanged', () => {
      expect(normalizeSetAside('SMALL_BUSINESS')).toBe('SMALL_BUSINESS');
    });

    it('should pass through SDVOSB unchanged', () => {
      expect(normalizeSetAside('SDVOSB')).toBe('SDVOSB');
    });

    it('should pass through NONE unchanged', () => {
      expect(normalizeSetAside('NONE')).toBe('NONE');
    });
  });
});

describe('QuickSummarySchema', () => {
  describe('AUTO-RFP-5Q regression: schema with preprocessing', () => {
    it('should accept FIRM_FIXED_PRICE and normalize to FFP', () => {
      const input = {
        title: 'Test Opportunity',
        summary: 'This is a test opportunity summary with at least 10 characters',
        contractType: 'FIRM_FIXED_PRICE',
      };

      const result = QuickSummarySchema.parse(input);
      expect(result.contractType).toBe('FFP');
    });

    it('should accept TIME_AND_MATERIALS and normalize to T&M', () => {
      const input = {
        title: 'Test',
        summary: 'A summary that is long enough for validation',
        contractType: 'TIME_AND_MATERIALS',
      };

      const result = QuickSummarySchema.parse(input);
      expect(result.contractType).toBe('T&M');
    });

    it('should accept FULL_AND_OPEN setAside and normalize to NONE', () => {
      const input = {
        title: 'Test',
        summary: 'A summary that is long enough for validation',
        setAside: 'FULL_AND_OPEN',
      };

      const result = QuickSummarySchema.parse(input);
      expect(result.setAside).toBe('NONE');
    });

    it('should accept SERVICE_DISABLED_VETERAN_OWNED and normalize to SDVOSB', () => {
      const input = {
        title: 'Test',
        summary: 'A summary that is long enough for validation',
        setAside: 'SERVICE_DISABLED_VETERAN_OWNED',
      };

      const result = QuickSummarySchema.parse(input);
      expect(result.setAside).toBe('SDVOSB');
    });

    it('should use default UNKNOWN when contractType is not provided', () => {
      const input = {
        title: 'Test',
        summary: 'A summary that is long enough for validation',
      };

      const result = QuickSummarySchema.parse(input);
      expect(result.contractType).toBe('UNKNOWN');
    });

    it('should use default UNKNOWN when setAside is not provided', () => {
      const input = {
        title: 'Test',
        summary: 'A summary that is long enough for validation',
      };

      const result = QuickSummarySchema.parse(input);
      expect(result.setAside).toBe('UNKNOWN');
    });
  });

  describe('validation', () => {
    it('should reject unknown contract type values', () => {
      const input = {
        title: 'Test',
        summary: 'A summary that is long enough for validation',
        contractType: 'INVALID_TYPE_THAT_DOES_NOT_EXIST',
      };

      expect(() => QuickSummarySchema.parse(input)).toThrow();
    });

    it('should reject summary that is too short', () => {
      const input = {
        title: 'Test',
        summary: 'Short',
      };

      expect(() => QuickSummarySchema.parse(input)).toThrow();
    });

    it('should accept valid NAICS code', () => {
      const input = {
        title: 'Test',
        summary: 'A summary that is long enough for validation',
        naics: '541512',
      };

      const result = QuickSummarySchema.parse(input);
      expect(result.naics).toBe('541512');
    });
  });
});
