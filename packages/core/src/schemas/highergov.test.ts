import { describe, it, expect } from 'vitest';
import {
  HigherGovOpportunitySearchResultSchema,
  buildAgencyLabel,
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

describe('HigherGovOpportunitySearchResultSchema', () => {
  it('parses a valid opportunity', () => {
    const { success, data } = HigherGovOpportunitySearchResultSchema.safeParse({
      opp_key: 'OPP-123',
      title: 'Test Opportunity',
      ai_summary: 'AI summary text',
      source_id: 'N-456',
      source_type: 'sam',
      posted_date: '2025-06-01',
      due_date: '2025-07-01',
      // Real API key names — `name`/`abbreviation`/`code`/`description` do not exist on
      // these objects, which is why the old reads always resolved to undefined.
      agency: { agency_name: 'Department of Defense', agency_abbreviation: 'DoD' },
      naics_code: { naics_code: '541511' },
      psc_code: { psc_code: 'D302' },
      opp_type: { description: 'SOLICITATION' },
      set_aside: 'Small Business',
      val_est_high: '500000',
      path: '/contract-opportunity/OPP-123',
    });
    expect(success).toBe(true);
    expect(data?.opp_key).toBe('OPP-123');
    // Assert the SHAPE, not just that parsing succeeded. `.passthrough()` accepts unknown
    // keys and every field is `.nullish()`, so without these the schema's field names are
    // untestable — the old wrong names would parse this fixture just as happily.
    expect(data?.agency?.agency_name).toBe('Department of Defense');
    expect(data?.agency?.agency_abbreviation).toBe('DoD');
    expect(data?.naics_code?.naics_code).toBe('541511');
    expect(data?.psc_code?.psc_code).toBe('D302');
    expect(data?.opp_type?.description).toBe('SOLICITATION');
  });

  it('parses the contact objects on their real keys', () => {
    // `primary_contact_email.email`/`.name` never existed — the API's PeopleSimple object
    // uses `contact_email`/`contact_name`. Imports saved null for both before the fix.
    const { success, data } = HigherGovOpportunitySearchResultSchema.safeParse({
      opp_key: 'OPP-C',
      primary_contact_email: { contact_name: 'Jane Doe', contact_email: 'jane@agency.gov' },
      secondary_contact_email: { contact_name: 'John Roe', contact_email: 'john@agency.gov' },
    });
    expect(success).toBe(true);
    expect(data?.primary_contact_email?.contact_email).toBe('jane@agency.gov');
    expect(data?.primary_contact_email?.contact_name).toBe('Jane Doe');
    expect(data?.secondary_contact_email?.contact_email).toBe('john@agency.gov');
  });

  it('accepts explicit nulls on scalar fields', () => {
    // The API sends explicit nulls, not omissions — `ai_summary` was null on 29 of 100
    // sampled live records, which `.optional()` does not describe. Note the client
    // currently CASTS rather than parses (helpers/highergov.ts), so today this schema is
    // compile-time documentation of the wire format; this test is what keeps it honest,
    // and it is a precondition for validating at the boundary later.
    const { success, data } = HigherGovOpportunitySearchResultSchema.safeParse({
      opp_key: 'OPP-N',
      title: null,
      ai_summary: null,
      description_text: null,
      posted_date: null,
      due_date: null,
      agency: null,
    });
    expect(success).toBe(true);
    expect(data?.ai_summary).toBeNull();
  });

  it('accepts minimal data (only opp_key required)', () => {
    const { success } = HigherGovOpportunitySearchResultSchema.safeParse({ opp_key: 'MIN-1' });
    expect(success).toBe(true);
  });

  it('passes through unknown fields', () => {
    const { success, data } = HigherGovOpportunitySearchResultSchema.safeParse({
      opp_key: 'PT-1',
      unknown_field: 'should be preserved',
    });
    expect(success).toBe(true);
    expect((data as Record<string, unknown>).unknown_field).toBe('should be preserved');
  });

  it('rejects missing opp_key', () => {
    const { success } = HigherGovOpportunitySearchResultSchema.safeParse({ title: 'No key' });
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
      agency: { agency_name: 'USAF' },
      naics_code: { naics_code: '541511' },
      opp_type: { description: 'SOLICITATION' },
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

describe('buildAgencyLabel', () => {
  it('combines name and abbreviation', () => {
    expect(buildAgencyLabel({ agency_name: 'Department of Defense', agency_abbreviation: 'DoD' }))
      .toBe('Department of Defense (DoD)');
  });

  it('omits the abbreviation when it duplicates the name', () => {
    expect(buildAgencyLabel({ agency_name: 'USAF', agency_abbreviation: 'USAF' })).toBe('USAF');
  });

  it('falls back to whichever field is present', () => {
    expect(buildAgencyLabel({ agency_name: 'USAF' })).toBe('USAF');
    expect(buildAgencyLabel({ agency_abbreviation: 'DoD' })).toBe('DoD');
  });

  it('returns null when the agency is absent or empty', () => {
    expect(buildAgencyLabel(undefined)).toBeNull();
    expect(buildAgencyLabel(null)).toBeNull();
    expect(buildAgencyLabel({})).toBeNull();
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