import { describe, it, expect } from 'vitest';
import {
  FOIADocumentTypeSchema,
  RequesterCategorySchema,
  FOIAAddressSchema,
  FOIAAgencyInfoSchema,
  CreateFOIARequestSchema,
  UpdateFOIARequestSchema,
  FOIA_DOCUMENT_DESCRIPTIONS,
  type FOIADocumentType,
} from './foia';

describe('FOIADocumentTypeSchema', () => {
  it('accepts all valid document types', () => {
    const validTypes: FOIADocumentType[] = [
      'SSEB_REPORT',
      'SSDD',
      'TECHNICAL_EVAL',
      'PRICE_ANALYSIS',
      'PAST_PERFORMANCE_EVAL',
      'PROPOSAL_ABSTRACT',
      'DEBRIEFING_NOTES',
      'WINNING_PROPOSAL_TECH',
      'CONSENSUS_WORKSHEETS',
      'RESPONSIBILITY_DETERMINATION',
      'CORRESPONDENCE',
      'AWARD_NOTICE',
      'SOLICITATION_RECORDS',
    ];

    validTypes.forEach((type) => {
      expect(FOIADocumentTypeSchema.safeParse(type).success).toBe(true);
    });
  });

  it('rejects invalid document types', () => {
    expect(FOIADocumentTypeSchema.safeParse('INVALID').success).toBe(false);
    expect(FOIADocumentTypeSchema.safeParse('').success).toBe(false);
  });
});

describe('RequesterCategorySchema', () => {
  it('accepts valid categories', () => {
    expect(RequesterCategorySchema.safeParse('COMMERCIAL').success).toBe(true);
    expect(RequesterCategorySchema.safeParse('EDUCATIONAL').success).toBe(true);
    expect(RequesterCategorySchema.safeParse('NEWS_MEDIA').success).toBe(true);
    expect(RequesterCategorySchema.safeParse('OTHER').success).toBe(true);
  });
});

describe('FOIAAddressSchema', () => {
  it('validates valid address', () => {
    const address = {
      street1: '123 Main St',
      street2: 'Suite 100',
      city: 'Washington',
      state: 'DC',
      zip: '20001',
    };

    const result = FOIAAddressSchema.safeParse(address);
    expect(result.success).toBe(true);
  });

  it('allows missing street2', () => {
    const address = {
      street1: '123 Main St',
      city: 'Washington',
      state: 'DC',
      zip: '20001',
    };

    const result = FOIAAddressSchema.safeParse(address);
    expect(result.success).toBe(true);
  });

  it('requires state to be 2 characters', () => {
    const address = {
      street1: '123 Main St',
      city: 'Washington',
      state: 'District of Columbia',
      zip: '20001',
    };

    const result = FOIAAddressSchema.safeParse(address);
    expect(result.success).toBe(false);
  });

  it('validates zip code length', () => {
    const addressShortZip = {
      street1: '123 Main St',
      city: 'Washington',
      state: 'DC',
      zip: '200',
    };

    expect(FOIAAddressSchema.safeParse(addressShortZip).success).toBe(false);

    const addressLongZip = {
      street1: '123 Main St',
      city: 'Washington',
      state: 'DC',
      zip: '20001-1234',
    };

    expect(FOIAAddressSchema.safeParse(addressLongZip).success).toBe(true);
  });
});

describe('FOIAAgencyInfoSchema', () => {
  it('validates complete agency info', () => {
    const agency = {
      id: 'tsa',
      name: 'Transportation Security Administration',
      abbreviation: 'TSA',
      parentAgencyId: 'dhs',
      parentAgencyName: 'Department of Homeland Security',
      foiaOfficeEmail: 'foia@tsa.dhs.gov',
      foiaOfficeAddress: {
        street1: '601 S 12th St',
        city: 'Arlington',
        state: 'VA',
        zip: '20598',
      },
      webPortalUrl: 'https://foiaonline.gov/foiaonline/action/public/home',
    };

    const result = FOIAAgencyInfoSchema.safeParse(agency);
    expect(result.success).toBe(true);
  });

  it('validates minimal agency info', () => {
    const agency = {
      id: 'tsa',
      name: 'Transportation Security Administration',
      abbreviation: 'TSA',
    };

    const result = FOIAAgencyInfoSchema.safeParse(agency);
    expect(result.success).toBe(true);
  });

  it('validates email format', () => {
    const agency = {
      id: 'tsa',
      name: 'TSA',
      abbreviation: 'TSA',
      foiaOfficeEmail: 'not-an-email',
    };

    const result = FOIAAgencyInfoSchema.safeParse(agency);
    expect(result.success).toBe(false);
  });
});

describe('CreateFOIARequestSchema', () => {
  const validRequest = {
    projectId: 'proj-123',
    orgId: 'org-456',
    opportunityId: 'opp-789',
    agencyName: 'Department of Defense',
    agencyFOIAEmail: 'foia@dod.gov',
    agencyFOIAAddress: '1400 Defense Pentagon, Washington DC',
    solicitationNumber: 'SOL-2025-001',
    contractTitle: 'IT Services',
    requesterName: 'John Doe',
    requesterTitle: 'Contracts Manager',
    requesterEmail: 'john@example.com',
    requesterPhone: '555-123-4567',
    requesterAddress: '123 Main St, City ST 12345',
    requestedDocuments: ['SSEB_REPORT', 'SSDD'],
    companyName: 'Acme Corp',
    awardeeName: 'Winning LLC',
    awardDate: 'January 15, 2026',
    feeLimit: 100,
  };

  it('validates valid create request with all required fields', () => {
    const result = CreateFOIARequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('requires at least one document type', () => {
    const request = {
      ...validRequest,
      requestedDocuments: [],
    };

    const result = CreateFOIARequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('applies default feeLimit of 0', () => {
    const { feeLimit, ...withoutFee } = validRequest;

    const result = CreateFOIARequestSchema.safeParse(withoutFee);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feeLimit).toBe(0);
    }
  });

  it('defaults customDocumentRequests to empty array', () => {
    const result = CreateFOIARequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customDocumentRequests).toEqual([]);
    }
  });

  it('accepts custom document requests', () => {
    const request = {
      ...validRequest,
      customDocumentRequests: ['Any emails regarding our proposal'],
    };

    const result = CreateFOIARequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('requires agencyFOIAEmail', () => {
    const { agencyFOIAEmail, ...without } = validRequest;
    const result = CreateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects invalid agencyFOIAEmail', () => {
    const result = CreateFOIARequestSchema.safeParse({ ...validRequest, agencyFOIAEmail: 'not-email' });
    expect(result.success).toBe(false);
  });

  it('requires agencyFOIAAddress', () => {
    const { agencyFOIAAddress, ...without } = validRequest;
    const result = CreateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires contractTitle', () => {
    const { contractTitle, ...without } = validRequest;
    const result = CreateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires companyName', () => {
    const { companyName, ...without } = validRequest;
    const result = CreateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('accepts request without awardeeName', () => {
    const { awardeeName, ...without } = validRequest;
    const result = CreateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(true);
  });

  it('treats empty awardeeName as undefined', () => {
    const result = CreateFOIARequestSchema.safeParse({ ...validRequest, awardeeName: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.awardeeName).toBeUndefined();
    }
  });

  it('requires awardDate', () => {
    const { awardDate, ...without } = validRequest;
    const result = CreateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires requesterTitle', () => {
    const { requesterTitle, ...without } = validRequest;
    const result = CreateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires requesterPhone', () => {
    const { requesterPhone, ...without } = validRequest;
    const result = CreateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires requesterAddress', () => {
    const { requesterAddress, ...without } = validRequest;
    const result = CreateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });
});

describe('UpdateFOIARequestSchema', () => {
  const validIdentifiers = {
    orgId: 'org-456',
    projectId: 'proj-123',
    opportunityId: 'opp-789',
    foiaRequestId: 'foia-001',
  };

  it('validates with only identifiers (no updatable fields)', () => {
    const result = UpdateFOIARequestSchema.safeParse(validIdentifiers);
    expect(result.success).toBe(true);
  });

  it('requires orgId', () => {
    const { orgId, ...without } = validIdentifiers;
    const result = UpdateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires projectId', () => {
    const { projectId, ...without } = validIdentifiers;
    const result = UpdateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires opportunityId', () => {
    const { opportunityId, ...without } = validIdentifiers;
    const result = UpdateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires foiaRequestId', () => {
    const { foiaRequestId, ...without } = validIdentifiers;
    const result = UpdateFOIARequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects empty identifier strings', () => {
    expect(UpdateFOIARequestSchema.safeParse({ ...validIdentifiers, orgId: '' }).success).toBe(false);
    expect(UpdateFOIARequestSchema.safeParse({ ...validIdentifiers, projectId: '' }).success).toBe(false);
    expect(UpdateFOIARequestSchema.safeParse({ ...validIdentifiers, opportunityId: '' }).success).toBe(false);
    expect(UpdateFOIARequestSchema.safeParse({ ...validIdentifiers, foiaRequestId: '' }).success).toBe(false);
  });

  it('accepts optional updatable fields', () => {
    const result = UpdateFOIARequestSchema.safeParse({
      ...validIdentifiers,
      agencyName: 'Updated Agency',
      requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL'],
      feeLimit: 250,
      companyName: 'New Corp',
      awardeeName: 'WinnerCo',
    });
    expect(result.success).toBe(true);
  });

  it('validates requesterEmail format when provided', () => {
    const result = UpdateFOIARequestSchema.safeParse({
      ...validIdentifiers,
      requesterEmail: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative feeLimit', () => {
    const result = UpdateFOIARequestSchema.safeParse({
      ...validIdentifiers,
      feeLimit: -10,
    });
    expect(result.success).toBe(false);
  });

  it('validates requestedDocuments contains valid types', () => {
    const result = UpdateFOIARequestSchema.safeParse({
      ...validIdentifiers,
      requestedDocuments: ['INVALID_TYPE'],
    });
    expect(result.success).toBe(false);
  });
});

describe('FOIA_DOCUMENT_DESCRIPTIONS', () => {
  it('has descriptions for all document types', () => {
    const allTypes: FOIADocumentType[] = [
      'SSEB_REPORT',
      'SSDD',
      'TECHNICAL_EVAL',
      'PRICE_ANALYSIS',
      'PAST_PERFORMANCE_EVAL',
      'PROPOSAL_ABSTRACT',
      'DEBRIEFING_NOTES',
      'WINNING_PROPOSAL_TECH',
      'CONSENSUS_WORKSHEETS',
      'RESPONSIBILITY_DETERMINATION',
      'CORRESPONDENCE',
      'AWARD_NOTICE',
      'SOLICITATION_RECORDS',
    ];

    allTypes.forEach((type) => {
      expect(FOIA_DOCUMENT_DESCRIPTIONS[type]).toBeDefined();
      expect(typeof FOIA_DOCUMENT_DESCRIPTIONS[type]).toBe('string');
      expect(FOIA_DOCUMENT_DESCRIPTIONS[type].length).toBeGreaterThan(10);
    });
  });
});
