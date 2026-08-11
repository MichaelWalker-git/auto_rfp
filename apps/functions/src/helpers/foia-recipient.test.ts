process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
}));

const mockGetAgencyContact = jest.fn();
jest.mock('@/helpers/foia-agency-contact', () => ({
  getAgencyContact: (...args: unknown[]) => mockGetAgencyContact(...args),
}));

const mockScanSolicitations = jest.fn();
jest.mock('@/helpers/foia-doc-scan', () => ({
  scanSolicitationsForFoiaContact: (...args: unknown[]) => mockScanSolicitations(...args),
}));

import type { OpportunityDBItem } from '@auto-rfp/core';

import { isSendableRecipient, resolveFoiaRecipient } from './foia-recipient';

const buildOpportunity = (overrides: Partial<OpportunityDBItem> = {}): OpportunityDBItem =>
  ({
    partition_key: 'OPPORTUNITY',
    sort_key: 'org-1#proj-1#opp-1',
    orgId: 'org-1',
    projectId: 'proj-1',
    oppId: 'opp-1',
    id: 'opp-1',
    source: 'HIGHER_GOV',
    title: 'Widget Support Services',
    organizationName: 'DEPT OF THE ARMY',
    status: 'LOST',
    ...overrides,
  }) as OpportunityDBItem;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAgencyContact.mockReset();
  mockScanSolicitations.mockReset();
  mockGetAgencyContact.mockResolvedValue(null);
  mockScanSolicitations.mockResolvedValue([]);
});

describe('resolveFoiaRecipient — tier 1 (opportunity FOIA override)', () => {
  it('uses the explicit FOIA override and does not touch later tiers', async () => {
    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity({
        foiaContactEmail: 'foia@army.mil',
        foiaContactAddress: '1000 Army Pentagon',
        foiaContactName: 'FOIA Officer',
        contactEmail: 'contracting.officer@army.mil',
      }),
    });

    expect(result.email).toBe('foia@army.mil');
    expect(result.address).toBe('1000 Army Pentagon');
    expect(result.source).toBe('OPP_FOIA_OVERRIDE');
    expect(result.blockedReason).toBeUndefined();
    // The override must win outright — no directory read, no document scan.
    expect(mockGetAgencyContact).not.toHaveBeenCalled();
    expect(mockScanSolicitations).not.toHaveBeenCalled();
  });

  it('beats the contracting-officer contact even when both are present', async () => {
    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity({
        foiaContactEmail: 'foia@army.mil',
        contactEmail: 'contracting.officer@army.mil',
      }),
    });

    expect(result.email).toBe('foia@army.mil');
  });

  it('falls back to the agency name for the address when none is given', async () => {
    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity({ foiaContactEmail: 'foia@army.mil' }),
    });

    expect(result.address).toBe('DEPT OF THE ARMY');
  });

  it('ignores a whitespace-only override', async () => {
    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity({
        foiaContactEmail: '   ',
        contactEmail: 'contracting.officer@army.mil',
      }),
    });

    expect(result.source).toBe('OPP_CONTACT');
  });
});

describe('resolveFoiaRecipient — tier 2 (imported point of contact)', () => {
  it('uses contactEmail when there is no FOIA override', async () => {
    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity({
        contactEmail: 'contracting.officer@army.mil',
        contactName: 'Jane Roe',
      }),
    });

    expect(result.email).toBe('contracting.officer@army.mil');
    expect(result.name).toBe('Jane Roe');
    expect(result.source).toBe('OPP_CONTACT');
    expect(mockGetAgencyContact).not.toHaveBeenCalled();
  });
});

describe('resolveFoiaRecipient — tier 4 (org agency directory)', () => {
  it('uses a saved directory entry when the opportunity has no contact', async () => {
    mockGetAgencyContact.mockResolvedValue({
      orgId: 'org-1',
      agencyKey: 'DEPT OF THE ARMY',
      agencyName: 'DEPT OF THE ARMY',
      foiaEmail: 'foia@army.mil',
      foiaAddress: '1000 Army Pentagon',
      acceptsEmail: true,
    });

    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity(),
    });

    expect(result.email).toBe('foia@army.mil');
    expect(result.source).toBe('ORG_AGENCY_CONTACT');
    // A confirmed directory entry outranks anything a scan could suggest.
    expect(mockScanSolicitations).not.toHaveBeenCalled();
  });

  it('blocks with AGENCY_REQUIRES_PORTAL rather than emailing a portal-only agency', async () => {
    mockGetAgencyContact.mockResolvedValue({
      orgId: 'org-1',
      agencyKey: 'SOME STATE AGENCY',
      agencyName: 'Some State Agency',
      foiaEmail: null,
      foiaAddress: '1 State St',
      acceptsEmail: false,
      webPortalUrl: 'https://records.example.gov/request',
    });

    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity(),
    });

    expect(result.blockedReason).toBe('AGENCY_REQUIRES_PORTAL');
    expect(result.email).toBeUndefined();
    expect(result.webPortalUrl).toBe('https://records.example.gov/request');
  });

  it('treats a bounced entry (acceptsEmail false) as unusable', async () => {
    mockGetAgencyContact.mockResolvedValue({
      orgId: 'org-1',
      agencyKey: 'DEPT OF THE ARMY',
      agencyName: 'DEPT OF THE ARMY',
      foiaEmail: 'dead-mailbox@army.mil',
      acceptsEmail: false,
      lastBounceReason: '550 user unknown',
    });

    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity(),
    });

    expect(result.blockedReason).toBe('AGENCY_REQUIRES_PORTAL');
    expect(result.email).toBeUndefined();
  });

  it('falls through to the document scan when the directory entry has no email', async () => {
    mockGetAgencyContact.mockResolvedValue({
      orgId: 'org-1',
      agencyKey: 'DEPT OF THE ARMY',
      agencyName: 'DEPT OF THE ARMY',
      foiaEmail: null,
      acceptsEmail: true,
    });
    mockScanSolicitations.mockResolvedValue([
      { email: 'foia@army.mil', context: 'FOIA Officer', score: 10 },
    ]);

    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity(),
    });

    expect(result.blockedReason).toBe('NEEDS_CONFIRMATION');
    expect(result.candidates).toHaveLength(1);
  });
});

describe('resolveFoiaRecipient — tier 3 (document scan)', () => {
  it('never auto-resolves a scanned address; it asks for confirmation', async () => {
    mockScanSolicitations.mockResolvedValue([
      { email: 'foia@army.mil', context: 'FOIA Officer at foia@army.mil', score: 14 },
      { email: 'contracting@army.mil', context: 'contracting officer', score: 2 },
    ]);

    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity(),
    });

    // Even the top-scoring candidate must be confirmed by a human.
    expect(result.blockedReason).toBe('NEEDS_CONFIRMATION');
    expect(result.email).toBeUndefined();
    expect(result.candidates?.map((c) => c.email)).toEqual([
      'foia@army.mil',
      'contracting@army.mil',
    ]);
  });

  it('can be skipped for dry runs', async () => {
    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity(),
      skipDocumentScan: true,
    });

    expect(mockScanSolicitations).not.toHaveBeenCalled();
    expect(result.blockedReason).toBe('NEEDS_RECIPIENT');
  });

  it('skips the scan when the opportunity has no project/opp identity', async () => {
    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity({ projectId: undefined, oppId: undefined }),
    });

    expect(mockScanSolicitations).not.toHaveBeenCalled();
    expect(result.blockedReason).toBe('NEEDS_RECIPIENT');
  });
});

describe('resolveFoiaRecipient — nothing found', () => {
  it('blocks with NEEDS_RECIPIENT rather than guessing', async () => {
    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity(),
    });

    expect(result.blockedReason).toBe('NEEDS_RECIPIENT');
    expect(result.email).toBeUndefined();
    expect(result.source).toBeUndefined();
  });

  it('handles an opportunity with no agency name at all', async () => {
    const result = await resolveFoiaRecipient({
      orgId: 'org-1',
      opportunity: buildOpportunity({ organizationName: null }),
    });

    expect(mockGetAgencyContact).not.toHaveBeenCalled();
    expect(result.blockedReason).toBe('NEEDS_RECIPIENT');
  });
});

describe('isSendableRecipient', () => {
  it('accepts a resolved address', () => {
    expect(
      isSendableRecipient({ email: 'foia@army.mil', source: 'OPP_CONTACT' }),
    ).toBe(true);
  });

  it('rejects anything blocked, even when an address is present', () => {
    expect(
      isSendableRecipient({
        email: 'foia@army.mil',
        source: 'ORG_AGENCY_CONTACT',
        blockedReason: 'AGENCY_REQUIRES_PORTAL',
      }),
    ).toBe(false);
  });

  it('rejects a result with no email', () => {
    expect(isSendableRecipient({ blockedReason: 'NEEDS_RECIPIENT' })).toBe(false);
    expect(isSendableRecipient({})).toBe(false);
  });
});
