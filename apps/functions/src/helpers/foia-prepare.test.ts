process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

const mockPutItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  putItem: (...a: unknown[]) => mockPutItem(...a),
}));

const mockDeriveFoiaRequest = jest.fn();
jest.mock('@/helpers/foia-derive', () => ({
  deriveFoiaRequest: (...a: unknown[]) => mockDeriveFoiaRequest(...a),
}));

const mockGenerateFOIALetter = jest.fn();
jest.mock('@/helpers/foia-letter', () => ({
  generateFOIALetter: (...a: unknown[]) => mockGenerateFOIALetter(...a),
}));

const mockPersistLetterText = jest.fn();
const mockPersistEml = jest.fn();
jest.mock('@/helpers/foia-artifacts', () => ({
  persistFoiaLetterText: (...a: unknown[]) => mockPersistLetterText(...a),
  persistFoiaEml: (...a: unknown[]) => mockPersistEml(...a),
  buildFoiaSubject: () => 'FOIA Request — Solicitation No. X',
}));

const mockSendNotification = jest.fn();
const mockBuildNotification = jest.fn();
jest.mock('@/helpers/send-notification', () => ({
  sendNotification: (...a: unknown[]) => mockSendNotification(...a),
  buildNotification: (...a: unknown[]) => {
    mockBuildNotification(...a);
    return { type: a[0] };
  },
}));

const mockGetOrgMembers = jest.fn();
jest.mock('@/helpers/user', () => ({
  getOrgMembers: (...a: unknown[]) => mockGetOrgMembers(...a),
}));

import type { FoiaSettingsItem, OpportunityDBItem } from '@auto-rfp/core';

import { prepareFoiaRequest } from './foia-prepare';

const opportunity = {
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
} as unknown as OpportunityDBItem;

const settings = {
  orgId: 'org-1',
  automationEnabled: true,
  delayDays: 90,
  mailScrapeEnabled: false,
  approvalReminderDays: [3, 7],
  stallAfterDays: 14,
  defaultRequestedDocuments: ['SSDD'],
  defaultFeeLimit: 0,
  dailySendCap: 5,
} as unknown as FoiaSettingsItem;

const derivedRequest = {
  foiaId: 'foia-1',
  agencyFOIAEmail: 'foia@army.mil',
  agencyFOIAAddress: '1000 Army Pentagon',
  solicitationNumber: 'W912-24-R-0001',
  recipientSource: 'ORG_AGENCY_CONTACT',
  // A recorded award. Auto-send requires this: without it we do not know an award
  // happened, and a request filed pre-award is routinely denied as premature.
  awardDate: '2026-01-29',
  awardDateProvenance: 'RECORDED_AWARD',
};

const baseArgs = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', opportunity, settings };

beforeEach(() => {
  jest.clearAllMocks();
  mockDeriveFoiaRequest.mockResolvedValue({ request: derivedRequest, recipientSource: 'ORG_AGENCY_CONTACT' });
  mockGenerateFOIALetter.mockReturnValue('Dear FOIA Officer, ...');
  mockPutItem.mockImplementation((_pk, _sk, item) => Promise.resolve(item));
  mockPersistLetterText.mockResolvedValue({ kind: 'LETTER_TXT', s3Key: 'k.txt' });
  mockPersistEml.mockResolvedValue({ kind: 'EML', s3Key: 'k.eml' });
  mockGetOrgMembers.mockResolvedValue([{ userId: 'u1', email: 'u1@acme.com' }]);
  mockSendNotification.mockResolvedValue(undefined);
});

describe('prepareFoiaRequest — happy path', () => {
  it('persists the request and returns both artifacts', async () => {
    const outcome = await prepareFoiaRequest(baseArgs);

    expect(outcome.status).toBe('PREPARED');
    if (outcome.status !== 'PREPARED') return;

    expect(outcome.letter).toBe('Dear FOIA Officer, ...');
    expect(outcome.artifacts).toHaveLength(2);
    expect(mockPutItem).toHaveBeenCalledWith(
      'FOIA_REQUEST',
      'org-1#proj-1#opp-1#foia-1',
      derivedRequest,
      false,
    );
  });

  it('frames the letter with the opportunity jurisdiction', async () => {
    await prepareFoiaRequest({
      ...baseArgs,
      opportunity: { ...opportunity, jurisdiction: 'STATE', state: 'California' } as OpportunityDBItem,
    });

    expect(mockGenerateFOIALetter).toHaveBeenCalledWith(
      derivedRequest,
      expect.objectContaining({ jurisdiction: 'STATE', state: 'California' }),
    );
  });

  /**
   * The live path for the false-statement defect.
   *
   * Won opportunities are FOIA-eligible (`FOIA_ELIGIBLE_OPPORTUNITY_STATUSES` is
   * `['WON', 'LOST']`) and a win always has a submission on record, so without this flag
   * every request filed on a win told the agency we were not selected for a contract we
   * had been awarded.
   */
  it('tells the letter when the opportunity was WON', async () => {
    await prepareFoiaRequest({
      ...baseArgs,
      opportunity: { ...opportunity, status: 'WON' } as OpportunityDBItem,
    });

    expect(mockGenerateFOIALetter).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isAwardee: true }),
    );
  });

  it('does not claim awardee status on a LOST opportunity', async () => {
    await prepareFoiaRequest(baseArgs);

    expect(mockGenerateFOIALetter).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isAwardee: false }),
    );
  });

  it('persists the request before writing artifacts', async () => {
    const order: string[] = [];
    mockPutItem.mockImplementation((_pk, _sk, item) => {
      order.push('put');
      return Promise.resolve(item);
    });
    mockPersistLetterText.mockImplementation(() => {
      order.push('artifact');
      return Promise.resolve({ kind: 'LETTER_TXT', s3Key: 'k' });
    });

    await prepareFoiaRequest(baseArgs);

    // Artifacts reference the stored foiaId; a stored request with missing
    // artifacts is recoverable, the reverse is an orphan.
    expect(order[0]).toBe('put');
  });

  it('still returns PREPARED when the .eml write fails', async () => {
    mockPersistEml.mockResolvedValue(null);

    const outcome = await prepareFoiaRequest(baseArgs);

    expect(outcome.status).toBe('PREPARED');
    if (outcome.status !== 'PREPARED') return;
    // Only the canonical text artifact survives — a convenience copy failing
    // must not fail a statutory filing.
    expect(outcome.artifacts).toHaveLength(1);
    expect(outcome.artifacts[0]?.kind).toBe('LETTER_TXT');
  });

  it('does not notify anyone on the happy path', async () => {
    await prepareFoiaRequest(baseArgs);

    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});

describe('prepareFoiaRequest — auto-send gate', () => {
  it.each([
    ['RESPONSE_DEADLINE', 'the response deadline'],
    ['FORECAST', 'a predicted announcement date'],
    [undefined, 'no provenance at all'],
  ])('refuses auto-send when the award date came from %s', async (provenance) => {
    /**
     * The premature-filing guard. An unverified date means we do not know an award
     * happened — on a real solicitation the response deadline preceded the true
     * award by 108 days, so the timer would have fired before there was anything
     * to ask about. A human may still send; the machine may not.
     */
    mockDeriveFoiaRequest.mockResolvedValue({
      request: { ...derivedRequest, awardDateProvenance: provenance },
      recipientSource: 'FOIA_GOV',
    });

    const outcome = await prepareFoiaRequest({
      ...baseArgs,
      settings: { ...settings, autoSendTrusted: true },
    });

    if (outcome.status !== 'PREPARED') throw new Error('expected PREPARED');
    // Still prepared and downloadable — just not sent unattended.
    expect(outcome.autoSendEligible).toBe(false);
  });

  it('allows auto-send once an award is actually on record', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({
      request: { ...derivedRequest, awardDateProvenance: 'RECORDED_AWARD' },
      recipientSource: 'FOIA_GOV',
    });

    const outcome = await prepareFoiaRequest({
      ...baseArgs,
      settings: { ...settings, autoSendTrusted: true },
    });

    if (outcome.status !== 'PREPARED') throw new Error('expected PREPARED');
    expect(outcome.autoSendEligible).toBe(true);
  });

  it('passes the verified-submission flag through to the letter', async () => {
    // Regression: this flag existed but had no caller, so every letter took the
    // neutral branch and the honest one was dead code.
    mockDeriveFoiaRequest.mockResolvedValue({
      request: derivedRequest,
      recipientSource: 'FOIA_GOV',
      hasVerifiedSubmission: true,
    });

    await prepareFoiaRequest(baseArgs);

    expect(mockGenerateFOIALetter).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hasVerifiedSubmission: true }),
    );
  });

  it('is not eligible when the org has not opted in, even for a trusted source', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({
      request: derivedRequest,
      recipientSource: 'FOIA_GOV',
    });

    const outcome = await prepareFoiaRequest(baseArgs);

    if (outcome.status !== 'PREPARED') throw new Error('expected PREPARED');
    // autoSendTrusted defaults false: the sending domain cannot pass DMARC at
    // .gov/.mil yet, so a "sent" request would silently never arrive.
    expect(outcome.autoSendEligible).toBe(false);
  });

  it('is eligible for a trusted source once the org opts in', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({
      request: derivedRequest,
      recipientSource: 'FOIA_GOV',
    });

    const outcome = await prepareFoiaRequest({
      ...baseArgs,
      settings: { ...settings, autoSendTrusted: true } as unknown as FoiaSettingsItem,
    });

    if (outcome.status !== 'PREPARED') throw new Error('expected PREPARED');
    expect(outcome.autoSendEligible).toBe(true);
    expect(outcome.recipientSource).toBe('FOIA_GOV');
  });

  it.each(['FOIA_GOV', 'HIGHERGOV_HIERARCHY', 'ORG_AGENCY_CONTACT', 'OPP_FOIA_OVERRIDE', 'USER_PROVIDED'])(
    'treats %s as trusted',
    async (source) => {
      mockDeriveFoiaRequest.mockResolvedValue({ request: derivedRequest, recipientSource: source });

      const outcome = await prepareFoiaRequest({
        ...baseArgs,
        settings: { ...settings, autoSendTrusted: true } as unknown as FoiaSettingsItem,
      });

      if (outcome.status !== 'PREPARED') throw new Error('expected PREPARED');
      expect(outcome.autoSendEligible).toBe(true);
    },
  );

  it.each(['OPP_CONTACT', 'DOCUMENT_SEARCH'])(
    'never auto-sends a %s recipient, even with the flag on',
    async (source) => {
      mockDeriveFoiaRequest.mockResolvedValue({ request: derivedRequest, recipientSource: source });

      const outcome = await prepareFoiaRequest({
        ...baseArgs,
        settings: { ...settings, autoSendTrusted: true } as unknown as FoiaSettingsItem,
      });

      if (outcome.status !== 'PREPARED') throw new Error('expected PREPARED');
      // A contracting officer is usually not the FOIA office, and a document-scan
      // hit is a regex inference. Both need a human to look.
      expect(outcome.autoSendEligible).toBe(false);
    },
  );

  it('is not eligible when no source was recorded at all', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({ request: derivedRequest });

    const outcome = await prepareFoiaRequest({
      ...baseArgs,
      settings: { ...settings, autoSendTrusted: true } as unknown as FoiaSettingsItem,
    });

    if (outcome.status !== 'PREPARED') throw new Error('expected PREPARED');
    expect(outcome.autoSendEligible).toBe(false);
  });
});

describe('prepareFoiaRequest — blocked', () => {
  it('returns the block reason and notifies the org', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({ blockedReason: 'NEEDS_RECIPIENT' });

    const outcome = await prepareFoiaRequest(baseArgs);

    expect(outcome.status).toBe('BLOCKED');
    if (outcome.status !== 'BLOCKED') return;
    expect(outcome.blockedReason).toBe('NEEDS_RECIPIENT');

    expect(mockBuildNotification).toHaveBeenCalledWith(
      'FOIA_BLOCKED',
      expect.any(String),
      expect.stringContaining('Widget Support Services'),
      expect.objectContaining({ entityId: 'opp-1' }),
    );
  });

  it('writes nothing when blocked', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({ blockedReason: 'NEEDS_RECIPIENT' });

    await prepareFoiaRequest(baseArgs);

    expect(mockPutItem).not.toHaveBeenCalled();
    expect(mockPersistLetterText).not.toHaveBeenCalled();
  });

  it('passes through missing fields for MISSING_LETTER_FIELDS', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({
      blockedReason: 'MISSING_LETTER_FIELDS',
      missingFields: ['requesterName', 'requesterEmail'],
    });

    const outcome = await prepareFoiaRequest(baseArgs);

    if (outcome.status !== 'BLOCKED') throw new Error('expected BLOCKED');
    expect(outcome.missingFields).toEqual(['requesterName', 'requesterEmail']);
  });

  it('passes through candidates for NEEDS_CONFIRMATION', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({
      blockedReason: 'NEEDS_CONFIRMATION',
      recipientCandidates: [{ email: 'foia@army.mil', context: 'FOIA Officer', score: 12 }],
    });

    const outcome = await prepareFoiaRequest(baseArgs);

    if (outcome.status !== 'BLOCKED') throw new Error('expected BLOCKED');
    expect(outcome.recipientCandidates).toHaveLength(1);
  });

  it('passes through the portal URL for AGENCY_REQUIRES_PORTAL', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({
      blockedReason: 'AGENCY_REQUIRES_PORTAL',
      webPortalUrl: 'https://records.example.gov',
    });

    const outcome = await prepareFoiaRequest(baseArgs);

    if (outcome.status !== 'BLOCKED') throw new Error('expected BLOCKED');
    expect(outcome.webPortalUrl).toBe('https://records.example.gov');
  });

  it('still reports the block when the notification fails', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({ blockedReason: 'NEEDS_RECIPIENT' });
    mockGetOrgMembers.mockRejectedValue(new Error('user table down'));

    const outcome = await prepareFoiaRequest(baseArgs);

    // The durable signal is the marker on the opportunity, not the notification.
    expect(outcome.status).toBe('BLOCKED');
  });

  it('defaults to NEEDS_RECIPIENT when derivation gives no reason', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({});

    const outcome = await prepareFoiaRequest(baseArgs);

    if (outcome.status !== 'BLOCKED') throw new Error('expected BLOCKED');
    expect(outcome.blockedReason).toBe('NEEDS_RECIPIENT');
  });
});

describe('prepareFoiaRequest — dry run', () => {
  it('composes the letter but writes nothing', async () => {
    const outcome = await prepareFoiaRequest({ ...baseArgs, dryRun: true });

    expect(outcome.status).toBe('PREPARED');
    if (outcome.status !== 'PREPARED') return;
    expect(outcome.letter).toBe('Dear FOIA Officer, ...');
    expect(outcome.artifacts).toEqual([]);
    expect(mockPutItem).not.toHaveBeenCalled();
    expect(mockPersistLetterText).not.toHaveBeenCalled();
  });

  it('does not notify on a blocked dry run', async () => {
    mockDeriveFoiaRequest.mockResolvedValue({ blockedReason: 'NEEDS_RECIPIENT' });

    await prepareFoiaRequest({ ...baseArgs, dryRun: true });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
