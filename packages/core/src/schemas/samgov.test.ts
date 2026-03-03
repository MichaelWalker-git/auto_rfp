import { describe, it, expect } from 'vitest';
import {
  MmDdYyyySchema,
  LoadSamOpportunitiesRequestSchema,
  SavedSearchSchema,
  CreateSavedSearchRequestSchema,
  PatchSchema,
  DollarRangeSchema,
  SavedSearchFrequencySchema,
} from './search-opportunity';

/**
 * Regression tests for Sentry issues:
 * - AUTO-RFP-53: rdlfrom "Expected MM/dd/yyyy"
 * - AUTO-RFP-4S: postedFrom "Expected MM/dd/yyyy"
 * - AUTO-RFP-4B: postedFrom "Expected MM/dd/yyyy" (9 occurrences)
 * - AUTO-RFP-3W: Invalid Procurement Type
 */

describe('MmDdYyyySchema - Date Validation (Sentry: AUTO-RFP-53, AUTO-RFP-4S, AUTO-RFP-4B)', () => {
  it('should accept valid MM/dd/yyyy format', () => {
    expect(MmDdYyyySchema.parse('01/15/2025')).toBe('01/15/2025');
    expect(MmDdYyyySchema.parse('12/31/2024')).toBe('12/31/2024');
  });

  it('should reject yyyy-MM-dd format (ISO format)', () => {
    expect(() => MmDdYyyySchema.parse('2025-01-15')).toThrow(/Expected MM\/dd\/yyyy/);
  });

  it('should accept values that match MM/dd/yyyy pattern (note: cannot validate semantic correctness)', () => {
    // Note: The regex only validates format, not semantic correctness
    // '15/01/2025' passes because it matches \d{2}\/\d{2}\/\d{4}
    // This is a known limitation - could be improved with date parsing validation
    expect(MmDdYyyySchema.parse('15/01/2025')).toBe('15/01/2025');
  });

  it('should reject invalid date strings', () => {
    expect(() => MmDdYyyySchema.parse('')).toThrow();
    expect(() => MmDdYyyySchema.parse('invalid')).toThrow();
    expect(() => MmDdYyyySchema.parse('01-15-2025')).toThrow();
    expect(() => MmDdYyyySchema.parse('1/15/2025')).toThrow(); // Missing leading zero
    expect(() => MmDdYyyySchema.parse('01/5/2025')).toThrow(); // Missing leading zero
  });

  it('should reject null and undefined', () => {
    expect(() => MmDdYyyySchema.parse(null)).toThrow();
    expect(() => MmDdYyyySchema.parse(undefined)).toThrow();
  });

  it('should reject timestamps', () => {
    expect(() => MmDdYyyySchema.parse('01/15/2025T00:00:00Z')).toThrow();
    expect(() => MmDdYyyySchema.parse('01/15/2025 12:00:00')).toThrow();
  });
});

describe('LoadSamOpportunitiesRequestSchema - Request Validation', () => {
  const validRequest = {
    postedFrom: '01/01/2025',
    postedTo: '01/31/2025',
    rdlfrom: '02/15/2025', // Response deadline from date
  };

  it('should accept valid minimal request', () => {
    const result = LoadSamOpportunitiesRequestSchema.parse(validRequest);
    expect(result.postedFrom).toBe('01/01/2025');
    expect(result.postedTo).toBe('01/31/2025');
  });

  it('should accept full request with all optional fields', () => {
    const fullRequest = {
      ...validRequest,
      keywords: 'software development',
      title: 'IT Services',
      naics: ['541511', '541512'],
      psc: ['D302', 'D306'],
      organizationCode: 'ARMY',
      organizationName: 'Department of the Army',
      setAsideCode: 'SBA',
      ptype: ['p', 'k'], // Valid procurement types
      state: 'VA',
      zip: '22030',
      dollarRange: { min: 100000, max: 500000 },
      limit: 100,
      offset: 0,
    };

    const result = LoadSamOpportunitiesRequestSchema.parse(fullRequest);
    expect(result.ptype).toEqual(['p', 'k']);
  });

  it('should reject missing required postedFrom field', () => {
    expect(() =>
      LoadSamOpportunitiesRequestSchema.parse({ postedTo: '01/31/2025' })
    ).toThrow();
  });

  it('should reject missing required postedTo field', () => {
    expect(() =>
      LoadSamOpportunitiesRequestSchema.parse({ postedFrom: '01/01/2025' })
    ).toThrow();
  });

  it('should accept request without optional rdlfrom field (fixes AUTO-RFP-5Q)', () => {
    const requestWithoutRdlfrom = {
      postedFrom: '01/01/2025',
      postedTo: '01/31/2025',
    };
    const result = LoadSamOpportunitiesRequestSchema.parse(requestWithoutRdlfrom);
    expect(result.postedFrom).toBe('01/01/2025');
    expect(result.postedTo).toBe('01/31/2025');
    expect(result.rdlfrom).toBeUndefined();
  });

  it('should reject invalid date format for postedFrom (Sentry: AUTO-RFP-4B)', () => {
    expect(() =>
      LoadSamOpportunitiesRequestSchema.parse({
        postedFrom: '2025-01-01', // Wrong format
        postedTo: '01/31/2025',
      })
    ).toThrow(/Expected MM\/dd\/yyyy/);
  });

  it('should reject invalid limit values', () => {
    expect(() =>
      LoadSamOpportunitiesRequestSchema.parse({
        ...validRequest,
        limit: 0,
      })
    ).toThrow();

    expect(() =>
      LoadSamOpportunitiesRequestSchema.parse({
        ...validRequest,
        limit: 1001,
      })
    ).toThrow();
  });

  it('should reject negative offset', () => {
    expect(() =>
      LoadSamOpportunitiesRequestSchema.parse({
        ...validRequest,
        offset: -1,
      })
    ).toThrow();
  });

  it('should reject invalid NAICS codes (too short)', () => {
    expect(() =>
      LoadSamOpportunitiesRequestSchema.parse({
        ...validRequest,
        naics: ['5'], // Too short
      })
    ).toThrow();
  });
});

describe('DollarRangeSchema', () => {
  it('should accept valid range', () => {
    const result = DollarRangeSchema.parse({ min: 100000, max: 500000 });
    expect(result?.min).toBe(100000);
    expect(result?.max).toBe(500000);
  });

  it('should accept partial range', () => {
    expect(DollarRangeSchema.parse({ min: 100000 })).toEqual({ min: 100000 });
    expect(DollarRangeSchema.parse({ max: 500000 })).toEqual({ max: 500000 });
  });

  it('should accept undefined', () => {
    expect(DollarRangeSchema.parse(undefined)).toBeUndefined();
  });

  it('should reject negative values', () => {
    expect(() => DollarRangeSchema.parse({ min: -100 })).toThrow();
    expect(() => DollarRangeSchema.parse({ max: -500 })).toThrow();
  });
});

describe('SavedSearchFrequencySchema', () => {
  it('should accept valid frequencies', () => {
    expect(SavedSearchFrequencySchema.parse('HOURLY')).toBe('HOURLY');
    expect(SavedSearchFrequencySchema.parse('DAILY')).toBe('DAILY');
    expect(SavedSearchFrequencySchema.parse('WEEKLY')).toBe('WEEKLY');
  });

  it('should reject invalid frequencies', () => {
    expect(() => SavedSearchFrequencySchema.parse('MONTHLY')).toThrow();
    expect(() => SavedSearchFrequencySchema.parse('hourly')).toThrow();
  });
});

describe('CreateSavedSearchRequestSchema', () => {
  const validRequest = {
    orgId: 'org-123',
    name: 'My Saved Search',
    criteria: {
      postedFrom: '01/01/2025',
      postedTo: '01/31/2025',
      rdlfrom: '02/15/2025',
    },
  };

  it('should accept valid request', () => {
    const result = CreateSavedSearchRequestSchema.parse(validRequest);
    expect(result.name).toBe('My Saved Search');
  });

  it('should reject empty name', () => {
    expect(() =>
      CreateSavedSearchRequestSchema.parse({ ...validRequest, name: '' })
    ).toThrow();
  });

  it('should reject name too long', () => {
    expect(() =>
      CreateSavedSearchRequestSchema.parse({
        ...validRequest,
        name: 'a'.repeat(121),
      })
    ).toThrow();
  });

  it('should validate nested criteria dates', () => {
    expect(() =>
      CreateSavedSearchRequestSchema.parse({
        ...validRequest,
        criteria: {
          postedFrom: '2025-01-01', // Wrong format in nested object
          postedTo: '01/31/2025',
          rdlfrom: '02/15/2025',
        },
      })
    ).toThrow(/Expected MM\/dd\/yyyy/);
  });

  it('should reject invalid email in notifyEmails', () => {
    expect(() =>
      CreateSavedSearchRequestSchema.parse({
        ...validRequest,
        notifyEmails: ['invalid-email'],
      })
    ).toThrow();
  });

  it('should accept valid notifyEmails', () => {
    const result = CreateSavedSearchRequestSchema.parse({
      ...validRequest,
      notifyEmails: ['test@example.com', 'admin@company.org'],
    });
    expect(result.notifyEmails).toHaveLength(2);
  });
});

describe('PatchSchema', () => {
  it('should accept valid partial update', () => {
    const result = PatchSchema.parse({ name: 'Updated Name' });
    expect(result.name).toBe('Updated Name');
  });

  it('should reject empty object', () => {
    expect(() => PatchSchema.parse({})).toThrow(/Patch body is required/);
  });

  it('should reject unknown fields (strict mode)', () => {
    expect(() =>
      PatchSchema.parse({ name: 'Test', unknownField: 'value' })
    ).toThrow();
  });

  it('should accept criteria update with valid dates', () => {
    const result = PatchSchema.parse({
      criteria: {
        postedFrom: '01/01/2025',
        postedTo: '02/28/2025',
        rdlfrom: '03/15/2025',
      },
    });
    expect(result.criteria?.postedFrom).toBe('01/01/2025');
  });
});

describe('SavedSearchSchema - Full Entity', () => {
  const validSavedSearch = {
    savedSearchId: 'search-123',
    orgId: 'org-456',
    name: 'Government IT Contracts',
    criteria: {
      postedFrom: '01/01/2025',
      postedTo: '12/31/2025',
      rdlfrom: '01/15/2025',
      keywords: 'software',
    },
    frequency: 'DAILY',
    autoImport: false,
    notifyEmails: [],
    isEnabled: true,
    lastRunAt: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  it('should accept valid saved search', () => {
    const result = SavedSearchSchema.parse(validSavedSearch);
    expect(result.savedSearchId).toBe('search-123');
  });

  it('should validate all nested criteria fields', () => {
    expect(() =>
      SavedSearchSchema.parse({
        ...validSavedSearch,
        criteria: {
          postedFrom: 'invalid-date',
          postedTo: '01/31/2025',
          rdlfrom: '02/15/2025',
        },
      })
    ).toThrow();
  });

  it('should validate lastRunAt as datetime or null', () => {
    const resultWithNull = SavedSearchSchema.parse(validSavedSearch);
    expect(resultWithNull.lastRunAt).toBeNull();

    const resultWithDate = SavedSearchSchema.parse({
      ...validSavedSearch,
      lastRunAt: '2025-01-15T10:30:00Z',
    });
    expect(resultWithDate.lastRunAt).toBe('2025-01-15T10:30:00Z');
  });
});
