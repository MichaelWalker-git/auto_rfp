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

const mockGetSubmissionHistory = jest.fn();
jest.mock('@/helpers/proposal-submission', () => ({
  getSubmissionHistory: (...a: unknown[]) => mockGetSubmissionHistory(...a),
}));

import { isVerifiedAwardDateProvenance } from '@auto-rfp/core';
import type { FoiaSettingsItem, OpportunityDBItem } from '@auto-rfp/core';

import { buildCompanyName, deriveFoiaRequest, resolveAwardDate } from './foia-derive';

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
  mockGetSubmissionHistory.mockResolvedValue([]);
});

describe('resolveAwardDate', () => {
  it('prefers a recorded award over a forecast announcement date', () => {
    // Order is by evidential strength, not by which field is populated most often.
    // `decisionDateIso` is a *prediction* of when the agency will announce — it is
    // not evidence an award happened, so a recorded award outranks it.
    expect(
      resolveAwardDate(
        buildOpp({
          decisionDateIso: '2026-03-01T00:00:00.000Z',
          winData: { awardDate: '2026-04-05T00:00:00.000Z' },
        }),
      ),
    ).toEqual({ date: '2026-04-05', provenance: 'RECORDED_AWARD' });
  });

  it('treats a recorded loss date as a recorded award', () => {
    // A loss means someone else was awarded — the procurement concluded.
    expect(
      resolveAwardDate(
        buildOpp({ decisionDateIso: null, lossData: { lossDate: '2026-05-06T00:00:00.000Z' } }),
      ),
    ).toEqual({ date: '2026-05-06', provenance: 'RECORDED_AWARD' });
  });

  it('labels a forecast announcement date as unverified', () => {
    expect(
      resolveAwardDate(
        buildOpp({
          decisionDateIso: '2026-03-01T00:00:00.000Z',
          responseDeadlineIso: '2026-01-01T00:00:00.000Z',
        }),
      ),
    ).toEqual({ date: '2026-03-01', provenance: 'FORECAST' });
  });

  it('labels the response deadline as the weakest fallback', () => {
    // The case that mattered: on a real solicitation the deadline preceded the
    // true award by 108 days, and the letter asserted it as the award date.
    expect(
      resolveAwardDate(
        buildOpp({ decisionDateIso: null, responseDeadlineIso: '2026-01-09T00:00:00.000Z' }),
      ),
    ).toEqual({ date: '2026-01-09', provenance: 'RESPONSE_DEADLINE' });
  });

  it('returns no date and no provenance when nothing is available', () => {
    expect(
      resolveAwardDate(buildOpp({ decisionDateIso: null, responseDeadlineIso: null })),
    ).toEqual({ date: undefined, provenance: undefined });
  });

  it('ignores a blank string rather than emitting an empty date', () => {
    expect(
      resolveAwardDate(
        buildOpp({ decisionDateIso: '   ', responseDeadlineIso: '2026-01-09T00:00:00.000Z' }),
      ),
    ).toEqual({ date: '2026-01-09', provenance: 'RESPONSE_DEADLINE' });
  });

  it('prefers the agency-stated award date over an unrelated recorded loss date', () => {
    /**
     * Real data, from opportunity 06b56638 (HORUSTECH, "RFP 739-SL3732580").
     *
     * The inbound-mail pipeline read "Award Date 1/29/2026" out of a real award
     * notice and recorded it — correctly, and only because the agency stated it (the
     * `provenance === 'RECORDED_AWARD'` guard in process-inbound-mail.ts). It
     * originally landed in `outcomeDate`, where `lossData.lossDate` (2026-06-10, the
     * moment a user clicked "lost") outranked it and resolved as RECORDED_AWARD —
     * 132 days wrong, with verified provenance that also satisfies the
     * unattended-send gate.
     *
     * Note the fix is NOT to promote `outcomeDate` above `lossDate`: 84 of the 85
     * populated `outcomeDate` values in dev are terminal-status click stamps written
     * by opportunity-status.ts, so promoting the field would have relabelled all of
     * them as award dates. The agency's date gets its own field instead.
     */
    expect(
      resolveAwardDate(
        buildOpp({
          decisionDateIso: '2026-05-08',
          responseDeadlineIso: '2026-05-08T21:30:00.000Z',
          agencyStatedAwardDate: '2026-01-29',
          lossData: { lossDate: '2026-06-10T14:02:32.066Z', lossReason: 'UNKNOWN' },
        }),
      ),
    ).toEqual({ date: '2026-01-29', provenance: 'RECORDED_AWARD' });
  });

  it('still ranks a recorded loss above a bare outcomeDate stamp', () => {
    // Guards the fix above from over-reaching: with no agency-stated date, the
    // previous ordering must be untouched, because `outcomeDate` is usually just
    // the terminal-status stamp rather than anything the agency said.
    expect(
      resolveAwardDate(
        buildOpp({
          decisionDateIso: null,
          outcomeDate: '2026-07-01T00:00:00.000Z',
          lossData: { lossDate: '2026-06-10T14:02:32.066Z', lossReason: 'UNKNOWN' },
        }),
      ),
    ).toEqual({ date: '2026-06-10', provenance: 'RECORDED_AWARD' });
  });

  it('never reports a verified provenance for a date it inferred', () => {
    // The property that keeps a false award claim out of a statutory filing.
    for (const opp of [
      buildOpp({ decisionDateIso: '2026-03-01T00:00:00.000Z', responseDeadlineIso: null }),
      buildOpp({ decisionDateIso: null, responseDeadlineIso: '2026-01-09T00:00:00.000Z' }),
    ]) {
      expect(isVerifiedAwardDateProvenance(resolveAwardDate(opp).provenance)).toBe(false);
    }
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

  it('records the award-date provenance alongside the date', async () => {
    const { request } = await deriveFoiaRequest({
      ...baseArgs(),
      opportunity: buildOpp({ winData: { awardDate: '2026-04-05T00:00:00.000Z' } }),
    });

    expect(request?.awardDate).toBe('2026-04-05');
    expect(request?.awardDateProvenance).toBe('RECORDED_AWARD');
  });
});

describe('deriveFoiaRequest — bidder-status evidence', () => {
  it('reports a verified submission when one is on record', async () => {
    mockGetSubmissionHistory.mockResolvedValue([
      { status: 'SUBMITTED', submittedAt: '2025-10-13T00:00:00.000Z' },
    ]);

    const { hasVerifiedSubmission } = await deriveFoiaRequest(baseArgs());

    expect(hasVerifiedSubmission).toBe(true);
  });

  it('reports no verified submission when none exists', async () => {
    // The real TTUHSC case: the agency replied "no record of Horus Technology's
    // participation in this solicitation was located". The letter must not claim
    // bidder status here.
    mockGetSubmissionHistory.mockResolvedValue([]);

    const { hasVerifiedSubmission } = await deriveFoiaRequest(baseArgs());

    expect(hasVerifiedSubmission).toBe(false);
  });

  it('does not count a withdrawn submission', async () => {
    // The letter claims a proposal was submitted and not selected — untrue of a
    // bid that was pulled before evaluation.
    mockGetSubmissionHistory.mockResolvedValue([
      { status: 'WITHDRAWN', submittedAt: '2025-10-13T00:00:00.000Z' },
    ]);

    const { hasVerifiedSubmission } = await deriveFoiaRequest(baseArgs());

    expect(hasVerifiedSubmission).toBe(false);
  });

  it('treats a lookup failure as unknown, never as verified', async () => {
    // An unavailable table cannot be grounds for asserting a fact about the
    // customer's bidding history to a government agency.
    mockGetSubmissionHistory.mockRejectedValue(new Error('dynamo unavailable'));

    const { hasVerifiedSubmission, request } = await deriveFoiaRequest(baseArgs());

    expect(hasVerifiedSubmission).toBe(false);
    // And the request is still derivable — this must not block the letter.
    expect(request).toBeDefined();
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

describe('buildCompanyName', () => {
  it('names both forms when they differ', () => {
    // The exact form a California agency used when replying to this company.
    expect(buildCompanyName('Horus Technology', 'Interesting Interests')).toBe(
      'Interesting Interests dba Horus Technology',
    );
  });

  it('does not duplicate a name that is the same in both fields', () => {
    expect(buildCompanyName('Acme Corp', 'Acme Corp')).toBe('Acme Corp');
    expect(buildCompanyName('Acme Corp', 'acme corp')).toBe('Acme Corp');
  });

  it('falls back to whichever name exists', () => {
    expect(buildCompanyName('Horus Technology', undefined)).toBe('Horus Technology');
    expect(buildCompanyName(undefined, 'Interesting Interests')).toBe('Interesting Interests');
    expect(buildCompanyName('Horus Technology', '')).toBe('Horus Technology');
    expect(buildCompanyName('  ', 'Interesting Interests')).toBe('Interesting Interests');
  });

  it('returns empty when neither is set, so the missing-fields guard fires', () => {
    // companyName is a required letter field; an empty value must block the send
    // rather than produce a letter from a nameless requester.
    expect(buildCompanyName(undefined, undefined)).toBe('');
    expect(buildCompanyName('', '')).toBe('');
  });
});
