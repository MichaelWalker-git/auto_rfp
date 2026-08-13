// Mock middy before imports
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

const mockGetFoiaAutomation = jest.fn();
const mockSetFoiaAutomationState = jest.fn();
const mockGetFoiaRequest = jest.fn();
const mockUpdateFoiaRequestFields = jest.fn();
const mockGetOpportunity = jest.fn();
const mockGetSubmissionHistory = jest.fn();
const mockPersistFoiaLetterText = jest.fn();
const mockPersistFoiaEml = jest.fn();
const mockBuildFoiaSubject = jest.fn();

jest.mock('@/helpers/foia-automation', () => ({
  getFoiaAutomation: (...args: unknown[]) => mockGetFoiaAutomation(...args),
  setFoiaAutomationState: (...args: unknown[]) => mockSetFoiaAutomationState(...args),
}));

jest.mock('@/helpers/foia', () => ({
  getFoiaRequest: (...args: unknown[]) => mockGetFoiaRequest(...args),
  updateFoiaRequestFields: (...args: unknown[]) => mockUpdateFoiaRequestFields(...args),
}));

jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
}));

jest.mock('@/helpers/proposal-submission', () => ({
  getSubmissionHistory: (...args: unknown[]) => mockGetSubmissionHistory(...args),
}));

jest.mock('@/helpers/foia-artifacts', () => ({
  persistFoiaLetterText: (...args: unknown[]) => mockPersistFoiaLetterText(...args),
  persistFoiaEml: (...args: unknown[]) => mockPersistFoiaEml(...args),
  buildFoiaSubject: (...args: unknown[]) => mockBuildFoiaSubject(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './update-foia-custom-documents';

type AuthedEvent = APIGatewayProxyEventV2 & { auth?: { userId?: string } };

const ORG = 'org-1';
const PROJ = 'proj-1';
const OPP = 'opp-1';
const FOIA_ID = 'foia-1';

const event = (body: unknown): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    auth: { userId: 'user-9' },
  }) as AuthedEvent;

const validBody = {
  orgId: ORG,
  projectId: PROJ,
  oppId: OPP,
  customDocumentRequests: ['Section 4.3 scoring worksheets'],
};

const baseRequest = {
  partition_key: 'FOIA_REQUEST',
  sort_key: `${ORG}#${PROJ}#${OPP}#${FOIA_ID}`,
  foiaId: FOIA_ID,
  id: FOIA_ID,
  orgId: ORG,
  projectId: PROJ,
  opportunityId: OPP,
  agencyName: 'Texas Tech University Health Sciences Center',
  agencyFOIAEmail: 'publicinfo@ttu.edu',
  agencyFOIAAddress: '3601 4th Street, Lubbock, TX 79430',
  solicitationNumber: 'RFP 739-SL3722874',
  contractTitle: 'Student Prospect Digital Profile Solution',
  requestedDocuments: ['AWARD_NOTICE'],
  customDocumentRequests: [],
  feeLimit: 100,
  companyName: 'Interesting Interests dba Horus Technology',
  awardDate: '2025-10-13',
  awardDateProvenance: 'RESPONSE_DEADLINE',
  requesterName: 'Brennen Stones',
  requesterTitle: 'Proposal Specialist',
  requesterEmail: 'brennen@horustech.dev',
  requesterPhone: '(555) 555-5555',
  requesterAddress: '123 Main St',
  requestedBy: 'system',
  createdBy: 'system',
  origin: 'AUTOMATED',
};

const staleTxt = {
  kind: 'LETTER_TXT',
  s3Key: `${ORG}/${PROJ}/${OPP}/foia/${FOIA_ID}/FOIA_Request_RFP_739.txt`,
  fileName: 'FOIA_Request_RFP_739.txt',
  contentType: 'text/plain',
  sizeBytes: 100,
  createdAt: '2026-08-01T00:00:00Z',
};

const freshTxt = { ...staleTxt, sizeBytes: 222, createdAt: '2026-08-13T00:00:00Z' };
const freshEml = { ...freshTxt, kind: 'LETTER_EML', fileName: 'x.eml', contentType: 'message/rfc822' };

const primeHappyPath = () => {
  mockGetFoiaAutomation.mockResolvedValue({
    orgId: ORG,
    projectId: PROJ,
    oppId: OPP,
    state: 'AWAITING_APPROVAL',
    foiaRequestId: FOIA_ID,
    artifacts: [staleTxt],
  });
  mockGetFoiaRequest.mockResolvedValue(baseRequest);
  mockGetOpportunity.mockResolvedValue({
    item: { jurisdiction: 'STATE', state: 'TX', title: 'T' },
  });
  mockGetSubmissionHistory.mockResolvedValue([]);
  mockUpdateFoiaRequestFields.mockResolvedValue(baseRequest);
  mockPersistFoiaLetterText.mockResolvedValue(freshTxt);
  mockPersistFoiaEml.mockResolvedValue(freshEml);
  mockBuildFoiaSubject.mockReturnValue('Texas Public Information Act Request');
  mockSetFoiaAutomationState.mockImplementation(async (args: { patch?: unknown }) => ({
    state: 'AWAITING_APPROVAL',
    ...(args.patch as Record<string, unknown>),
  }));
};

describe('update-foia-custom-documents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    [
      mockGetFoiaAutomation,
      mockSetFoiaAutomationState,
      mockGetFoiaRequest,
      mockUpdateFoiaRequestFields,
      mockGetOpportunity,
      mockGetSubmissionHistory,
      mockPersistFoiaLetterText,
      mockPersistFoiaEml,
      mockBuildFoiaSubject,
    ].forEach((m) => m.mockReset());
  });

  it('persists the new list and returns the re-rendered letter', async () => {
    primeHappyPath();

    const res = await baseHandler(event(validBody));

    expect(res).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((res as { body: string }).body);
    expect(body.letter).toContain('Section 4.3 scoring worksheets');

    expect(mockUpdateFoiaRequestFields).toHaveBeenCalledWith(ORG, PROJ, OPP, FOIA_ID, {
      customDocumentRequests: ['Section 4.3 scoring worksheets'],
    });
  });

  /**
   * The bug this handler exists to prevent: both send paths transmit the persisted
   * artifact, so an edit that does not re-render ships the pre-edit letter while the
   * reviewer's preview shows their change.
   */
  it('re-renders the artifacts so the sent letter matches the edit', async () => {
    primeHappyPath();

    await baseHandler(event(validBody));

    // The letter handed to S3 must contain the new item.
    const persisted = mockPersistFoiaLetterText.mock.calls[0]![0] as { letter: string };
    expect(persisted.letter).toContain('Section 4.3 scoring worksheets');

    // The stored list must REPLACE the stale artifact, not append after it —
    // readFoiaLetterText takes the first LETTER_TXT it finds.
    const patch = (mockSetFoiaAutomationState.mock.calls[0]![0] as {
      patch: { artifacts: Array<{ kind: string; createdAt: string }> };
    }).patch;
    expect(patch.artifacts).toHaveLength(2);
    expect(patch.artifacts.filter((a) => a.kind === 'LETTER_TXT')).toEqual([freshTxt]);
    expect(patch.artifacts).not.toContainEqual(staleTxt);
  });

  it('writes the DB row before the artifacts', async () => {
    primeHappyPath();
    const order: string[] = [];
    mockUpdateFoiaRequestFields.mockImplementation(async () => {
      order.push('row');
      return baseRequest;
    });
    mockPersistFoiaLetterText.mockImplementation(async () => {
      order.push('artifact');
      return freshTxt;
    });

    await baseHandler(event(validBody));

    expect(order).toEqual(['row', 'artifact']);
  });

  it.each(['SENT', 'SENDING'])('refuses to edit a %s request', async (state) => {
    primeHappyPath();
    mockGetFoiaAutomation.mockResolvedValue({
      state,
      foiaRequestId: FOIA_ID,
      artifacts: [staleTxt],
    });

    const res = await baseHandler(event(validBody));

    expect(res).toMatchObject({ statusCode: 409 });
    expect(mockUpdateFoiaRequestFields).not.toHaveBeenCalled();
    expect(mockPersistFoiaLetterText).not.toHaveBeenCalled();
  });

  it('allows editing a FAILED request and leaves it FAILED', async () => {
    primeHappyPath();
    mockGetFoiaAutomation.mockResolvedValue({
      state: 'FAILED',
      foiaRequestId: FOIA_ID,
      artifacts: [staleTxt],
    });

    const res = await baseHandler(event(validBody));

    expect(res).toMatchObject({ statusCode: 200 });
    expect(mockSetFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'FAILED' }),
    );
  });

  it('claims bidder status only when a submission is on record', async () => {
    primeHappyPath();
    mockGetSubmissionHistory.mockResolvedValue([
      { submittedAt: '2025-09-01T00:00:00Z', status: 'SUBMITTED' },
    ]);

    await baseHandler(event(validBody));

    const persisted = mockPersistFoiaLetterText.mock.calls[0]![0] as { letter: string };
    expect(persisted.letter).toContain('submitted a proposal');
  });

  it('does not claim bidder status when the submission was withdrawn', async () => {
    primeHappyPath();
    mockGetSubmissionHistory.mockResolvedValue([
      { submittedAt: '2025-09-01T00:00:00Z', status: 'WITHDRAWN' },
    ]);

    await baseHandler(event(validBody));

    const persisted = mockPersistFoiaLetterText.mock.calls[0]![0] as { letter: string };
    expect(persisted.letter).toContain('no claim of bidder status is asserted');
  });

  it('treats a submission-lookup failure as no evidence', async () => {
    primeHappyPath();
    mockGetSubmissionHistory.mockRejectedValue(new Error('table unavailable'));

    await baseHandler(event(validBody));

    const persisted = mockPersistFoiaLetterText.mock.calls[0]![0] as { letter: string };
    expect(persisted.letter).toContain('no claim of bidder status is asserted');
  });

  it('accepts an empty array to clear the list', async () => {
    primeHappyPath();

    const res = await baseHandler(event({ ...validBody, customDocumentRequests: [] }));

    expect(res).toMatchObject({ statusCode: 200 });
    expect(mockUpdateFoiaRequestFields).toHaveBeenCalledWith(ORG, PROJ, OPP, FOIA_ID, {
      customDocumentRequests: [],
    });
  });

  it('rejects an empty-string entry', async () => {
    primeHappyPath();

    const res = await baseHandler(event({ ...validBody, customDocumentRequests: ['  '] }));

    expect(res).toMatchObject({ statusCode: 400 });
    expect(mockUpdateFoiaRequestFields).not.toHaveBeenCalled();
  });

  it('rejects more than 25 entries', async () => {
    primeHappyPath();

    const res = await baseHandler(
      event({ ...validBody, customDocumentRequests: Array.from({ length: 26 }, (_, i) => `d${i}`) }),
    );

    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('404s when no automation exists', async () => {
    primeHappyPath();
    mockGetFoiaAutomation.mockResolvedValue(null);

    expect(await baseHandler(event(validBody))).toMatchObject({ statusCode: 404 });
  });

  it('409s when the letter has not been composed yet', async () => {
    primeHappyPath();
    mockGetFoiaAutomation.mockResolvedValue({ state: 'AWAITING_APPROVAL', artifacts: [] });

    expect(await baseHandler(event(validBody))).toMatchObject({ statusCode: 409 });
  });

  it('404s when the request row is missing', async () => {
    primeHappyPath();
    mockGetFoiaRequest.mockResolvedValue(null);

    expect(await baseHandler(event(validBody))).toMatchObject({ statusCode: 404 });
  });

  it('still succeeds when the .eml fails to persist', async () => {
    primeHappyPath();
    mockPersistFoiaEml.mockResolvedValue(null);

    const res = await baseHandler(event(validBody));

    expect(res).toMatchObject({ statusCode: 200 });
    const patch = (mockSetFoiaAutomationState.mock.calls[0]![0] as {
      patch: { artifacts: unknown[] };
    }).patch;
    expect(patch.artifacts).toEqual([freshTxt]);
  });
});
