process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.SES_FROM_EMAIL = 'noreply@horustech.dev';
process.env.REGION = 'us-east-1';

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({}),
  setAuditContext: jest.fn(),
}));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  GetCommand: jest.fn((p) => ({ type: 'Get', params: p })),
  PutCommand: jest.fn((p) => ({ type: 'Put', params: p })),
  UpdateCommand: jest.fn((p) => ({ type: 'Update', params: p })),
  QueryCommand: jest.fn((p) => ({ type: 'Query', params: p })),
}));

const mockGetAutomation = jest.fn();
const mockTransition = jest.fn();
const mockSyncMarker = jest.fn();
jest.mock('@/helpers/foia-automation', () => ({
  getFoiaAutomation: (...a: unknown[]) => mockGetAutomation(...a),
  transitionFoiaAutomationState: (...a: unknown[]) => mockTransition(...a),
  syncOpportunityFoiaMarker: (...a: unknown[]) => mockSyncMarker(...a),
}));

const mockGetRequest = jest.fn();
const mockUpdateRequest = jest.fn();
jest.mock('@/helpers/foia', () => ({
  getFoiaRequest: (...a: unknown[]) => mockGetRequest(...a),
  updateFoiaRequestFields: (...a: unknown[]) => mockUpdateRequest(...a),
}));

const mockSend = jest.fn();
jest.mock('@/helpers/foia-send', () => ({ sendFoiaRequest: (...a: unknown[]) => mockSend(...a) }));

jest.mock('@/helpers/foia-letter', () => ({ generateFOIALetter: () => 'Dear FOIA Officer, ...' }));
const mockReadFoiaLetterText = jest.fn();
jest.mock('@/helpers/foia-artifacts', () => ({
  buildFoiaSubject: () => 'FOIA Request — X',
  readFoiaLetterText: (...a: unknown[]) => mockReadFoiaLetterText(...a),
}));

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...a: unknown[]) => mockGetOpportunity(...a),
}));

jest.mock('@/helpers/org-contact', () => ({
  getOrgPrimaryContact: () => Promise.resolve({ email: 'signer@acme.com', name: 'Jane' }),
}));

jest.mock('@/helpers/user', () => ({ getOrgMembers: () => Promise.resolve([]) }));
jest.mock('@/helpers/send-notification', () => ({
  sendNotification: jest.fn(() => Promise.resolve()),
  buildNotification: jest.fn((type: string) => ({ type })),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getUserId: () => 'user-1',
}));

import { baseHandler } from './send-foia-request';

const event = (over: Record<string, unknown> = {}) =>
  ({
    body: JSON.stringify({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', ...over }),
    requestContext: { http: { sourceIp: '1.2.3.4' } },
    headers: {},
  }) as never;

const automation = (over: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  projectId: 'proj-1',
  oppId: 'opp-1',
  state: 'AWAITING_APPROVAL',
  foiaRequestId: 'foia-1',
  attemptCount: 0,
  artifacts: [],
  ...over,
});

const parse = (res: { body: string }) => JSON.parse(res.body);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAutomation.mockResolvedValue(automation());
  mockGetRequest.mockResolvedValue({
    foiaId: 'foia-1',
    agencyFOIAEmail: 'foia@army.mil',
    requesterEmail: 'jane@acme.com',
  });
  mockGetOpportunity.mockResolvedValue({ item: { title: 'Widget Support', jurisdiction: 'FEDERAL' } });
  mockTransition.mockResolvedValue({ state: 'SENDING' });
  mockSend.mockResolvedValue({ messageId: 'ses-1', recipient: 'foia@army.mil', attached: [] });
  mockSyncMarker.mockResolvedValue(undefined);
  mockUpdateRequest.mockResolvedValue({});
  // Default: the approved letter is on file, which is the normal case.
  mockReadFoiaLetterText.mockResolvedValue('APPROVED LETTER BYTES');
});

describe('send-foia-request — happy path', () => {
  it('claims the lock before calling SES', async () => {
    const order: string[] = [];
    mockTransition.mockImplementation((args: { to: string }) => {
      order.push(`transition:${args.to}`);
      return Promise.resolve({ state: args.to });
    });
    mockSend.mockImplementation(() => {
      order.push('ses');
      return Promise.resolve({ messageId: 'ses-1', recipient: 'foia@army.mil', attached: [] });
    });

    await baseHandler(event());

    // The conditional write must precede the send, or two approvals could both
    // transmit the same statutory request.
    expect(order).toEqual(['transition:SENDING', 'ses', 'transition:SENT']);
  });

  it('records sentAt, the SES id, and the marker', async () => {
    const res = (await baseHandler(event())) as { statusCode: number; body: string };

    expect(res.statusCode).toBe(200);
    expect(parse(res).messageId).toBe('ses-1');
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'SENDING',
        to: 'SENT',
        patch: expect.objectContaining({ sesMessageId: 'ses-1' }),
      }),
    );
    expect(mockSyncMarker).toHaveBeenCalledWith('org-1', 'proj-1', 'opp-1', 'SENT');
  });

  it('copies the org primary contact', async () => {
    await baseHandler(event());

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ ccEmail: 'signer@acme.com' }),
    );
  });
});

describe('send-foia-request — guards', () => {
  it('400s on an invalid payload', async () => {
    const res = (await baseHandler({ body: '{}' } as never)) as { statusCode: number };
    expect(res.statusCode).toBe(400);
  });

  it('404s when there is no automation record', async () => {
    mockGetAutomation.mockResolvedValue(null);
    const res = (await baseHandler(event())) as { statusCode: number };
    expect(res.statusCode).toBe(404);
  });

  it('409s when the request has not been prepared', async () => {
    mockGetAutomation.mockResolvedValue(automation({ foiaRequestId: null, state: 'SCHEDULED' }));
    const res = (await baseHandler(event())) as { statusCode: number };
    expect(res.statusCode).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('404s when the FOIA request record is missing', async () => {
    mockGetRequest.mockResolvedValue(null);
    const res = (await baseHandler(event())) as { statusCode: number };
    expect(res.statusCode).toBe(404);
  });

  it('409s rather than sending when the retry cap is exhausted', async () => {
    mockGetAutomation.mockResolvedValue(automation({ state: 'FAILED', attemptCount: 3 }));

    const res = (await baseHandler(event())) as { statusCode: number };

    expect(res.statusCode).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('409s without sending when the lock is already held', async () => {
    // Null from the conditional write means a concurrent caller won the race, or
    // the record is already SENT.
    mockTransition.mockResolvedValue(null);

    const res = (await baseHandler(event())) as { statusCode: number };

    expect(res.statusCode).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('allows a retry from FAILED and from STALLED, but never from SENT', async () => {
    await baseHandler(event());

    const [args] = mockTransition.mock.calls[0]! as [{ from: string[] }];
    expect(args.from).toEqual(['AWAITING_APPROVAL', 'STALLED', 'FAILED']);
    expect(args.from).not.toContain('SENT');
  });
});

describe('send-foia-request — failure handling', () => {
  it('releases the lock to FAILED when SES throws', async () => {
    mockSend.mockRejectedValue(new Error('Throttling'));

    const res = (await baseHandler(event())) as { statusCode: number; body: string };

    expect(res.statusCode).toBe(502);
    // Leaving the record in SENDING would strand it: the reconciler skips
    // SENDING, so nothing would ever retry or surface it.
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'SENDING',
        to: 'FAILED',
        patch: expect.objectContaining({ lastError: 'Throttling' }),
      }),
    );
    expect(mockSyncMarker).toHaveBeenCalledWith('org-1', 'proj-1', 'opp-1', 'FAILED');
  });

  it('increments the attempt count on failure', async () => {
    mockGetAutomation.mockResolvedValue(automation({ attemptCount: 1 }));
    mockSend.mockRejectedValue(new Error('boom'));

    await baseHandler(event());

    const failCall = mockTransition.mock.calls.find(
      (c) => (c[0] as { to: string }).to === 'FAILED',
    )![0] as { patch: { attemptCount: number } };
    expect(failCall.patch.attemptCount).toBe(2);
  });
});

describe('send-foia-request — dry run', () => {
  it('returns the composed letter without sending', async () => {
    const res = (await baseHandler(event({ dryRun: true }))) as { statusCode: number; body: string };

    expect(res.statusCode).toBe(200);
    expect(parse(res).dryRun).toBe(true);
    // The approved bytes, not a re-render — a preview of anything else would mean
    // approving something other than what gets sent.
    expect(parse(res).letter).toBe('APPROVED LETTER BYTES');
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('releases the lock back to AWAITING_APPROVAL', async () => {
    await baseHandler(event({ dryRun: true }));

    // A dry run must not leave the record looking sent or locked.
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'SENDING', to: 'AWAITING_APPROVAL' }),
    );
    expect(mockTransition).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'SENT' }));
  });
});

describe('send-foia-request — transmits the approved bytes', () => {
  it('sends the persisted letter, not a fresh render', async () => {
    /**
     * The letter's content depends on hasVerifiedSubmission, award-date
     * provenance, the org's legal name, the requester contact and the state-law
     * lookup. Re-rendering at send time would transmit whatever the template
     * produces now, which is not necessarily what the approver read — so a
     * template edit could silently alter a statutory filing after sign-off.
     */
    await baseHandler(event());

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ letter: 'APPROVED LETTER BYTES' }),
    );
    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ letter: 'Dear FOIA Officer, ...' }),
    );
  });

  it('reads the letter from the automation record artifacts', async () => {
    const artifacts = [{ kind: 'LETTER_TXT', s3Key: 'k.txt' }];
    mockGetAutomation.mockResolvedValue({ ...automation(), artifacts });

    await baseHandler(event());

    expect(mockReadFoiaLetterText).toHaveBeenCalledWith(artifacts);
  });

  it('falls back to a render when no artifact exists', async () => {
    // Requests prepared before artifacts were persisted have nothing to read
    // back; refusing to send those would be worse than re-rendering.
    mockReadFoiaLetterText.mockResolvedValue(null);

    const res = await baseHandler(event());

    expect(res.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ letter: 'Dear FOIA Officer, ...' }),
    );
  });

  it('falls back to a render when S3 is unreadable, rather than stranding the lock', async () => {
    // SENDING is a lock. An unreadable artifact must not leave the record stuck.
    mockReadFoiaLetterText.mockRejectedValue(new Error('access denied'));

    const res = await baseHandler(event());

    expect(res.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalled();
  });

  it('returns the approved letter from a dry run', async () => {
    // The preview must show what would actually be sent, or approving it means
    // approving something else.
    const res = await baseHandler(event({ dryRun: true }));
    const body = JSON.parse(res.body as string);

    expect(body.letter).toBe('APPROVED LETTER BYTES');
  });
});
