process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

const mockGetOrganizationById = jest.fn();
jest.mock('@/helpers/org', () => ({
  getOrganizationById: (...a: unknown[]) => mockGetOrganizationById(...a),
}));

const mockGetOrgPrimaryContact = jest.fn();
jest.mock('@/helpers/org-contact', () => ({
  getOrgPrimaryContact: (...a: unknown[]) => mockGetOrgPrimaryContact(...a),
}));

const mockResolveFoiaRecipient = jest.fn();
jest.mock('@/helpers/foia-recipient', () => ({
  resolveFoiaRecipient: (...a: unknown[]) => mockResolveFoiaRecipient(...a),
}));

import type { FoiaSettingsItem, OpportunityDBItem } from '@auto-rfp/core';

import { deriveFoiaRequest, resolveAwardDate } from './foia-derive';

const buildOpp = (overrides: Record<string, unknown> = {}) =>
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
    solicitationNumber: 'W912-24-R-0001',
    status: 'LOST',
    decisionDateIso: '2026-03-01T00:00:00.000Z',
    ...overrides,
  }) as unknown as OpportunityDBItem;

const settings = {
  orgId: 'org-1',
  defaultRequestedDocuments: ['SSDD', 'TECHNICAL_EVAL'],
  defaultFeeLimit: 25,
} as unknown as FoiaSettingsItem;

const fullContact = {
  orgId: 'org-1',
  name: 'Jane Doe',
  title: 'VP Contracts',
  email: 'jane@acme.com',
  phone: '555-0100',
  address: '1 Acme Way',
};

const baseArgs = () => ({
  orgId: 'org-1',
  projectId: 'proj-1',
  oppId: 'opp-1',
  opportunity: buildOpp(),
  settings,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOrganizationById.mockResolvedValue({ id: 'org-1', name: 'Acme Corp' });
  mockGetOrgPrimaryContact.mockResolvedValue(fullContact);
  mockResolveFoiaRecipient.mockResolvedValue({
    email: 'foia@army.mil',
    address: '1000 Army Pentagon',
    source: 'ORG_AGENCY_CONTACT',
  });
});

describe('resolveAwardDate', () => {
  it('prefers the agency-announced decision date', () => {
    expect(
      resolveAwardDate(
        buildOpp({
          decisionDateIso: '2026-03-01T00:00:00.000Z',
          responseDeadlineIso: '2026-01-01T00:00:00.000Z',
        }),
      ),
    ).toBe('2026-03-01');
  });

  it('falls back to the recorded win date', () => {
    expect(
      resolveAwardDate(
        buildOpp({ decisionDateIso: null, winData: { awardDate: '2026-04-05T00:00:00.000Z' } }),
      ),
    ).toBe('2026-04-05');
  });

  it('falls back to the recorded loss date', () => {
    expect(
      resolveAwardDate(
        buildOpp({ decisionDateIso: null, lossData: { lossDate: '2026-05-06T00:00:00.000Z' } }),
      ),
    ).toBe('2026-05-06');
  });

  it('falls back to the response deadline as a last resort', () => {
    expect(
      resolveAwardDate(
        buildOpp({ decisionDateIso: null, responseDeadlineIso: '2026-01-09T00:00:00.000Z' }),
      ),
    ).toBe('2026-01-09');
  });

  it('returns undefined when no date is available at all', () => {
    expect(
      resolveAwardDate(buildOpp({ decisionDateIso: null, responseDeadlineIso: null })),
    ).toBeUndefined();
  });

  it('ignores a blank string rather than emitting an empty date', () => {
    expect(
      resolveAwardDate(
        buildOpp({ decisionDateIso: '   ', responseDeadlineIso: '2026-01-09T00:00:00.000Z' }),
      ),
    ).toBe('2026-01-09');
  });
});

describe('deriveFoiaRequest — field derivation', () => {
  it('derives every required letter field', async () => {
    const { request, blockedReason } = await deriveFoiaRequest(baseArgs());

    expect(blockedReason).toBeUndefined();
    expect(request).toBeDefined();
    expect(request).toMatchObject({
      agencyName: 'DEPT OF THE ARMY',
      agencyFOIAEmail: 'foia@army.mil',
      agencyFOIAAddress: '1000 Army Pentagon',
      solicitationNumber: 'W912-24-R-0001',
      contractTitle: 'Widget Support Services',
      companyName: 'Acme Corp',
      awardDate: '2026-03-01',
      requesterName: 'Jane Doe',
      requesterTitle: 'VP Contracts',
      requesterEmail: 'jane@acme.com',
      requesterPhone: '555-0100',
      requesterAddress: '1 Acme Way',
      origin: 'AUTOMATED',
      recipientSource: 'ORG_AGENCY_CONTACT',
    });
  });

  it('takes the requested documents and fee limit from org settings', async () => {
    const { request } = await deriveFoiaRequest(baseArgs());

    expect(request?.requestedDocuments).toEqual(['SSDD', 'TECHNICAL_EVAL']);
    expect(request?.feeLimit).toBe(25);
  });

  it('names the winning contractor on a loss', async () => {
    const { request } = await deriveFoiaRequest({
      ...baseArgs(),
      opportunity: buildOpp({ lossData: { winningContractor: 'Globex Inc' } }),
    });

    expect(request?.awardeeName).toBe('Globex Inc');
  });

  it('leaves awardeeName unset on a win', async () => {
    // On a win we are the awardee; naming ourselves in the letter's "awarded to"
    // clause would read as nonsense.
    const { request } = await deriveFoiaRequest({
      ...baseArgs(),
      opportunity: buildOpp({ status: 'WON', winData: { awardDate: '2026-03-01T00:00:00.000Z' } }),
    });

    expect(request?.awardeeName).toBeUndefined();
  });

  it('marks the request as machine-composed with a fresh id', async () => {
    const { request } = await deriveFoiaRequest(baseArgs());

    expect(request?.origin).toBe('AUTOMATED');
    expect(request?.foiaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request?.id).toBe(request?.foiaId);
    expect(request?.requestedBy).toBe('system');
  });
});

describe('deriveFoiaRequest — blocking', () => {
  it('surfaces a recipient block without attempting composition', async () => {
    mockResolveFoiaRecipient.mockResolvedValue({ blockedReason: 'NEEDS_RECIPIENT' });

    const result = await deriveFoiaRequest(baseArgs());

    expect(result.blockedReason).toBe('NEEDS_RECIPIENT');
    expect(result.request).toBeUndefined();
  });

  it('passes candidates through for confirmation', async () => {
    mockResolveFoiaRecipient.mockResolvedValue({
      blockedReason: 'NEEDS_CONFIRMATION',
      candidates: [{ email: 'foia@army.mil', context: 'FOIA Officer', score: 12 }],
    });

    const result = await deriveFoiaRequest(baseArgs());

    expect(result.recipientCandidates).toHaveLength(1);
  });

  it('blocks with MISSING_LETTER_FIELDS when there is no primary contact', async () => {
    mockGetOrgPrimaryContact.mockResolvedValue(null);

    const result = await deriveFoiaRequest(baseArgs());

    expect(result.blockedReason).toBe('MISSING_LETTER_FIELDS');
    // The block names exactly what a human has to supply.
    expect(result.missingFields).toEqual(
      expect.arrayContaining(['requesterName', 'requesterTitle', 'requesterEmail']),
    );
  });

  it('blocks when the primary contact has no phone or address', async () => {
    mockGetOrgPrimaryContact.mockResolvedValue({
      ...fullContact,
      phone: undefined,
      address: undefined,
    });

    const result = await deriveFoiaRequest(baseArgs());

    expect(result.missingFields).toEqual(
      expect.arrayContaining(['requesterPhone', 'requesterAddress']),
    );
  });

  it('blocks when no award date can be derived', async () => {
    const result = await deriveFoiaRequest({
      ...baseArgs(),
      opportunity: buildOpp({ decisionDateIso: null, responseDeadlineIso: null }),
    });

    expect(result.blockedReason).toBe('MISSING_LETTER_FIELDS');
    expect(result.missingFields).toContain('awardDate');
  });

  it('blocks when the opportunity has no solicitation number', async () => {
    const result = await deriveFoiaRequest({
      ...baseArgs(),
      opportunity: buildOpp({ solicitationNumber: null }),
    });

    expect(result.missingFields).toContain('solicitationNumber');
  });

  it('blocks when the organization name is unavailable', async () => {
    mockGetOrganizationById.mockResolvedValue(null);

    const result = await deriveFoiaRequest(baseArgs());

    expect(result.missingFields).toContain('companyName');
  });

  it('survives an org lookup failure and reports the resulting gap', async () => {
    mockGetOrganizationById.mockRejectedValue(new Error('dynamo down'));

    const result = await deriveFoiaRequest(baseArgs());

    // A transient lookup failure becomes a recoverable block, not a crash.
    expect(result.blockedReason).toBe('MISSING_LETTER_FIELDS');
    expect(result.missingFields).toContain('companyName');
  });

  it('forwards skipDocumentScan to the resolver', async () => {
    await deriveFoiaRequest({ ...baseArgs(), skipDocumentScan: true });

    expect(mockResolveFoiaRecipient).toHaveBeenCalledWith(
      expect.objectContaining({ skipDocumentScan: true }),
    );
  });
});
