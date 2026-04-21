import { describe, it, expect } from 'vitest';
import {
  HigherGovOpportunitySlimSchema,
  higherGovToSearchOpportunity,
  ImportHigherGovRequestSchema,
  OpportunitySourceSchema,
  SavedSearchSourceSchema,
} from './index';

describe('OpportunitySourceSchema', () => {
  it('includes HIGHER_GOV', () => {
    expect(OpportunitySourceSchema.safeParse('HIGHER_GOV').success).toBe(true);
  });
});

describe('SavedSearchSourceSchema', () => {
  it('includes HIGHER_GOV', () => {
    expect(SavedSearchSourceSchema.safeParse('HIGHER_GOV').success).toBe(true);
  });
});

describe('HigherGovOpportunitySlimSchema', () => {
  it('parses a valid opportunity', () => {
    const { success, data } = HigherGovOpportunitySlimSchema.safeParse({
      opp_key: 'OPP-123',
      title: 'Test Opportunity',
      ai_summary: 'AI summary text',
      source_id: 'N-456',
      source_type: 'sam',
      posted_date: '2025-06-01',
      due_date: '2025-07-01',
      agency: { name: 'DoD', abbreviation: 'DOD', type: 'Federal' },
      naics_code: { code: '541511', description: 'Custom Computer Programming' },
      psc_code: { code: 'D302', description: 'IT Services' },
      opp_type: { name: 'SOLICITATION' },
      set_aside: 'Small Business',
      val_est_high: '500000',
      path: '/contract-opportunity/OPP-123',
    });
    expect(success).toBe(true);
    expect(data?.opp_key).toBe('OPP-123');
  });

  it('accepts minimal data (only opp_key required)', () => {
    const { success } = HigherGovOpportunitySlimSchema.safeParse({ opp_key: 'MIN-1' });
    expect(success).toBe(true);
  });

  it('passes through unknown fields', () => {
    const { success, data } = HigherGovOpportunitySlimSchema.safeParse({
      opp_key: 'PT-1',
      unknown_field: 'should be preserved',
    });
    expect(success).toBe(true);
    expect((data as Record<string, unknown>).unknown_field).toBe('should be preserved');
  });

  it('rejects missing opp_key', () => {
    const { success } = HigherGovOpportunitySlimSchema.safeParse({ title: 'No key' });
    expect(success).toBe(false);
  });
});

describe('higherGovToSearchOpportunity', () => {
  it('maps all fields correctly', () => {
    const result = higherGovToSearchOpportunity({
      opp_key: 'OPP-1',
      title: 'Test',
      ai_summary: 'AI text',
      description_text: 'Full description',
      source_id: 'SAM-123',
      posted_date: '2025-06-01',
      due_date: '2025-07-15',
      agency: { name: 'USAF' },
      naics_code: { code: '541511' },
      opp_type: { name: 'SOLICITATION' },
      set_aside: 'SDVOSB',
      val_est_high: '250000',
      path: '/contract-opportunity/OPP-1',
    });

    expect(result.id).toBe('OPP-1');
    expect(result.source).toBe('HIGHER_GOV');
    expect(result.title).toBe('Test');
    expect(result.noticeId).toBe('SAM-123');
    expect(result.description).toBe('AI text\n\nFull description'); // both ai_summary and description_text included
    expect(result.postedDate).toBe('2025-06-01');
    expect(result.closingDate).toBe('2025-07-15');
    expect(result.organizationName).toBe('USAF'); // single name, no abbreviation different from name
    expect(result.naicsCode).toBe('541511');
    expect(result.type).toBe('SOLICITATION');
    expect(result.setAside).toBe('SDVOSB');
    expect(result.baseAndAllOptionsValue).toBe(250000);
    expect(result.url).toBe('https://www.highergov.com/contract-opportunity/OPP-1');
    expect(result.active).toBe(true);
    expect(result.attachmentsCount).toBe(0);
    expect(result.solicitationNumber).toBeNull();
    expect(result.contractVehicle).toBeNull();
    expect(result.technologyArea).toBeNull();
    expect(result.descriptionUrl).toBeNull();
  });

  it('falls back to description_text when ai_summary is missing', () => {
    const result = higherGovToSearchOpportunity({
      opp_key: 'OPP-2',
      description_text: 'Fallback description',
    });
    expect(result.description).toBe('Fallback description');
  });

  it('handles missing optional fields gracefully', () => {
    const result = higherGovToSearchOpportunity({ opp_key: 'OPP-MIN' });
    expect(result.id).toBe('OPP-MIN');
    expect(result.title).toBe('');
    expect(result.noticeId).toBeNull();
    expect(result.baseAndAllOptionsValue).toBeNull();
    expect(result.url).toBeNull();
  });

  it('parses val_est_high as number', () => {
    const result = higherGovToSearchOpportunity({ opp_key: 'V', val_est_high: '1234567.89' });
    expect(result.baseAndAllOptionsValue).toBe(1234567.89);
  });

  it('returns null for non-numeric val_est_high', () => {
    const result = higherGovToSearchOpportunity({ opp_key: 'V', val_est_high: 'N/A' });
    expect(result.baseAndAllOptionsValue).toBeNull();
  });

  it('handles path that is already a full URL', () => {
    const result = higherGovToSearchOpportunity({
      opp_key: 'U',
      path: 'https://www.highergov.com/sl/contract-opportunity/test-123',
    });
    expect(result.url).toBe('https://www.highergov.com/sl/contract-opportunity/test-123');
  });

  it('handles relative path without leading slash', () => {
    const result = higherGovToSearchOpportunity({ opp_key: 'U', path: 'contract-opportunity/test' });
    expect(result.url).toBe('https://www.highergov.com/contract-opportunity/test');
  });

  it('fixes malformed URL-like path (https// without colon)', () => {
    const result = higherGovToSearchOpportunity({
      opp_key: 'U',
      path: 'https//www.highergov.com/sl/contract-opportunity/test-123',
    });
    expect(result.url).toBe('https://www.highergov.com/sl/contract-opportunity/test-123');
  });
});

describe('ImportHigherGovRequestSchema', () => {
  it('validates a valid request', () => {
    const { success } = ImportHigherGovRequestSchema.safeParse({
      source: 'HIGHER_GOV',
      orgId: 'org-1',
      projectId: 'proj-1',
      oppKey: 'OPP-99',
    });
    expect(success).toBe(true);
  });

  it('rejects wrong source literal', () => {
    const { success } = ImportHigherGovRequestSchema.safeParse({
      source: 'SAM_GOV',
      orgId: 'org-1',
      projectId: 'proj-1',
      oppKey: 'OPP-99',
    });
    expect(success).toBe(false);
  });

  it('rejects missing oppKey', () => {
    const { success } = ImportHigherGovRequestSchema.safeParse({
      source: 'HIGHER_GOV',
      orgId: 'org-1',
      projectId: 'proj-1',
    });
    expect(success).toBe(false);
  });
});