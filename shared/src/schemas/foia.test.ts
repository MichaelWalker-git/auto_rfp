import { describe, it, expect } from 'vitest';
import {
  FOIADocumentTypeSchema,
  FOIAStatusSchema,
  RequesterCategorySchema,
  FOIASubmissionMethodSchema,
  FOIAResponseStatusSchema,
  FOIAAddressSchema,
  S3ReferenceSchema,
  FOIAStatusChangeSchema,
  FOIAAgencyInfoSchema,
  FOIARequestItemSchema,
  CreateFOIARequestSchema,
  UpdateFOIAStatusSchema,
  SubmitFOIARequestSchema,
  GenerateFOIAAppealSchema,
  ListFOIARequestsQuerySchema,
  calculateFOIADeadline,
  calculateFOIAExtensionDeadline,
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
      'WINNING_PROPOSAL_TECH',
      'CONSENSUS_WORKSHEETS',
      'RESPONSIBILITY_DETERMINATION',
      'CORRESPONDENCE',
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

describe('FOIAStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const validStatuses = [
      'DRAFT',
      'READY_TO_SUBMIT',
      'SUBMITTED',
      'ACKNOWLEDGED',
      'IN_PROCESSING',
      'RESPONSE_RECEIVED',
      'APPEAL_FILED',
      'CLOSED',
    ];

    validStatuses.forEach((status) => {
      expect(FOIAStatusSchema.safeParse(status).success).toBe(true);
    });
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

describe('S3ReferenceSchema', () => {
  it('validates valid S3 reference', () => {
    const ref = {
      bucket: 'auto-rfp-documents',
      key: 'foia/responses/doc-123.pdf',
      filename: 'evaluation-report.pdf',
      uploadedAt: '2025-01-20T10:00:00Z',
    };

    const result = S3ReferenceSchema.safeParse(ref);
    expect(result.success).toBe(true);
  });

  it('requires all fields', () => {
    const ref = {
      bucket: 'auto-rfp-documents',
      key: 'foia/responses/doc-123.pdf',
    };

    const result = S3ReferenceSchema.safeParse(ref);
    expect(result.success).toBe(false);
  });
});

describe('FOIAStatusChangeSchema', () => {
  it('validates status change entry', () => {
    const change = {
      status: 'SUBMITTED',
      changedAt: '2025-01-20T10:00:00Z',
      changedBy: 'user-123',
      notes: 'Submitted via email',
    };

    const result = FOIAStatusChangeSchema.safeParse(change);
    expect(result.success).toBe(true);
  });

  it('allows missing notes', () => {
    const change = {
      status: 'ACKNOWLEDGED',
      changedAt: '2025-01-22T10:00:00Z',
      changedBy: 'user-123',
    };

    const result = FOIAStatusChangeSchema.safeParse(change);
    expect(result.success).toBe(true);
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
  it('validates valid create request', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      requestedDocuments: ['SSEB_REPORT', 'SSDD'],
      requesterCategory: 'COMMERCIAL',
      feeLimit: 100,
      requestFeeWaiver: false,
    };

    const result = CreateFOIARequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('requires at least one document type', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      requestedDocuments: [],
    };

    const result = CreateFOIARequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('applies default values', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      requestedDocuments: ['SSEB_REPORT'],
    };

    const result = CreateFOIARequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requesterCategory).toBe('OTHER');
      expect(result.data.feeLimit).toBe(50);
      expect(result.data.requestFeeWaiver).toBe(false);
    }
  });

  it('allows custom document requests', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      requestedDocuments: ['SSEB_REPORT'],
      customDocumentRequests: ['Any emails regarding our proposal'],
    };

    const result = CreateFOIARequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });
});

describe('UpdateFOIAStatusSchema', () => {
  it('validates status update', () => {
    const update = {
      status: 'ACKNOWLEDGED',
      trackingNumber: 'FOIA-2025-001234',
      notes: 'Agency acknowledged receipt',
    };

    const result = UpdateFOIAStatusSchema.safeParse(update);
    expect(result.success).toBe(true);
  });

  it('requires status', () => {
    const update = {
      trackingNumber: 'FOIA-2025-001234',
    };

    const result = UpdateFOIAStatusSchema.safeParse(update);
    expect(result.success).toBe(false);
  });
});

describe('SubmitFOIARequestSchema', () => {
  it('accepts AUTO_EMAIL method', () => {
    const submit = { method: 'AUTO_EMAIL' };
    const result = SubmitFOIARequestSchema.safeParse(submit);
    expect(result.success).toBe(true);
  });

  it('accepts MANUAL method', () => {
    const submit = { method: 'MANUAL' };
    const result = SubmitFOIARequestSchema.safeParse(submit);
    expect(result.success).toBe(true);
  });

  it('rejects invalid method', () => {
    const submit = { method: 'WEB_PORTAL' };
    const result = SubmitFOIARequestSchema.safeParse(submit);
    expect(result.success).toBe(false);
  });
});

describe('GenerateFOIAAppealSchema', () => {
  it('validates valid appeal request', () => {
    const appeal = {
      foiaId: '550e8400-e29b-41d4-a716-446655440000',
      appealReason: 'The agency improperly withheld documents citing Exemption 4',
    };

    const result = GenerateFOIAAppealSchema.safeParse(appeal);
    expect(result.success).toBe(true);
  });

  it('requires UUID for foiaId', () => {
    const appeal = {
      foiaId: 'not-a-uuid',
      appealReason: 'Documents were improperly withheld',
    };

    const result = GenerateFOIAAppealSchema.safeParse(appeal);
    expect(result.success).toBe(false);
  });

  it('requires appeal reason to be at least 10 characters', () => {
    const appeal = {
      foiaId: '550e8400-e29b-41d4-a716-446655440000',
      appealReason: 'short',
    };

    const result = GenerateFOIAAppealSchema.safeParse(appeal);
    expect(result.success).toBe(false);
  });
});

describe('ListFOIARequestsQuerySchema', () => {
  it('validates valid query', () => {
    const query = {
      orgId: 'org-123',
      status: 'SUBMITTED',
      limit: 50,
    };

    const result = ListFOIARequestsQuerySchema.safeParse(query);
    expect(result.success).toBe(true);
  });

  it('applies default values', () => {
    const query = {
      orgId: 'org-123',
    };

    const result = ListFOIARequestsQuerySchema.safeParse(query);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it('rejects limit over 100', () => {
    const query = {
      orgId: 'org-123',
      limit: 150,
    };

    const result = ListFOIARequestsQuerySchema.safeParse(query);
    expect(result.success).toBe(false);
  });
});

describe('calculateFOIADeadline', () => {
  it('calculates 20 business days from Monday', () => {
    // Monday January 6, 2025
    const submission = new Date('2025-01-06T10:00:00Z');
    const deadline = calculateFOIADeadline(submission);

    // 20 business days = 4 weeks = February 3, 2025 (Monday)
    expect(deadline.getDate()).toBe(3);
    expect(deadline.getMonth()).toBe(1); // February
  });

  it('skips weekends', () => {
    // Friday January 3, 2025
    const submission = new Date('2025-01-03T10:00:00Z');
    const deadline = calculateFOIADeadline(submission);

    // Should be January 31, 2025 (Friday)
    expect(deadline.getDate()).toBe(31);
    expect(deadline.getMonth()).toBe(0); // January
  });
});

describe('calculateFOIAExtensionDeadline', () => {
  it('adds 10 business days', () => {
    // Original deadline: Monday February 3, 2025
    const originalDeadline = new Date('2025-02-03T10:00:00Z');
    const extensionDeadline = calculateFOIAExtensionDeadline(originalDeadline);

    // 10 business days = 2 weeks = February 17, 2025 (Monday)
    expect(extensionDeadline.getDate()).toBe(17);
    expect(extensionDeadline.getMonth()).toBe(1); // February
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
      'WINNING_PROPOSAL_TECH',
      'CONSENSUS_WORKSHEETS',
      'RESPONSIBILITY_DETERMINATION',
      'CORRESPONDENCE',
    ];

    allTypes.forEach((type) => {
      expect(FOIA_DOCUMENT_DESCRIPTIONS[type]).toBeDefined();
      expect(typeof FOIA_DOCUMENT_DESCRIPTIONS[type]).toBe('string');
      expect(FOIA_DOCUMENT_DESCRIPTIONS[type].length).toBeGreaterThan(20);
    });
  });
});
