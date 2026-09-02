process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';
process.env.SES_FROM_EMAIL = 'noreply@horustech.dev';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  GetCommand: jest.fn((p) => ({ type: 'Get', params: p })),
  UpdateCommand: jest.fn((p) => ({ type: 'Update', params: p })),
}));

const mockGetFoiaRequest = jest.fn();
const mockUpdateFoiaRequestFields = jest.fn();
jest.mock('@/helpers/foia', () => ({
  getFoiaRequest: (...a: unknown[]) => mockGetFoiaRequest(...a),
  updateFoiaRequestFields: (...a: unknown[]) => mockUpdateFoiaRequestFields(...a),
}));

const mockTransition = jest.fn();
const mockSyncMarker = jest.fn();
jest.mock('@/helpers/foia-automation', () => ({
  transitionFoiaAutomationState: (...a: unknown[]) => mockTransition(...a),
  syncOpportunityFoiaMarker: (...a: unknown[]) => mockSyncMarker(...a),
}));

const mockReadFoiaLetterText = jest.fn();
jest.mock('@/helpers/foia-artifacts', () => ({
  readFoiaLetterText: (...a: unknown[]) => mockReadFoiaLetterText(...a),
  buildFoiaSubject: () => 'FOIA Request — X',
}));

jest.mock('@/helpers/foia-letter', () => ({
  generateFOIALetter: () => 'RENDERED FALLBACK',
}));

const mockSendFoiaRequest = jest.fn();
jest.mock('@/helpers/foia-send', () => ({
  sendFoiaRequest: (...a: unknown[]) => mockSendFoiaRequest(...a),
}));

/**
 * Mocked, not left to run.
 *
 * The real helper reaches SSM for the HMAC secret and DynamoDB for the write, and it
 * swallows its own failures by design so a broken audit never strands a delivered send.
 * Unmocked, every test here silently exercised the failure branch — passing while
 * proving nothing about whether the audit is written.
 */
const mockWriteFoiaSendAuditLog = jest.fn();
jest.mock('@/helpers/foia-audit', () => ({
  writeFoiaSendAuditLog: (...a: unknown[]) => mockWriteFoiaSendAuditLog(...a),
}));

import { dispatchFoiaRequest } from './foia-dispatch';
import type { FoiaAutomationDBItem } from '@auto-rfp/core';

const automation = (over: Partial<FoiaAutomationDBItem> = {}): FoiaAutomationDBItem =>
  ({
    orgId: 'org-1',
    projectId: 'proj-1',
    oppId: 'opp-1',
    state: 'AWAITING_APPROVAL',
    foiaRequestId: 'foia-1',
    attemptCount: 0,
    artifacts: [{ kind: 'LETTER_TXT', s3Key: 'k.txt' }],
    ...over,
  }) as unknown as FoiaAutomationDBItem;

/** Every transition the code attempted, in order. */
const transitions = (): string[] =>
  mockTransition.mock.calls.map((c) => `${(c[0] as { from: unknown }).from}->${(c[0] as { to: string }).to}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFoiaRequest.mockResolvedValue({
    foiaId: 'foia-1',
    agencyFOIAEmail: 'foia@army.mil',
    solicitationNumber: 'W912-24-R-0001',
  });
  mockTransition.mockImplementation((args: { to: string }) =>
    Promise.resolve({ state: args.to }),
  );
  mockReadFoiaLetterText.mockResolvedValue('APPROVED BYTES');
  mockSendFoiaRequest.mockResolvedValue({ messageId: 'ses-1', recipient: 'foia@army.mil' });
  mockSyncMarker.mockResolvedValue(undefined);
  mockUpdateFoiaRequestFields.mockResolvedValue({});
});

describe('dispatchFoiaRequest — success', () => {
  it('claims the lock before calling SES', async () => {
    const order: string[] = [];
    mockTransition.mockImplementation((args: { to: string }) => {
      order.push(`transition:${args.to}`);
      return Promise.resolve({ state: args.to });
    });
    mockSendFoiaRequest.mockImplementation(() => {
      order.push('ses');
      return Promise.resolve({ messageId: 'ses-1', recipient: 'foia@army.mil' });
    });

    await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    // The conditional write must precede SES, or two runs could both send.
    expect(order).toEqual(['transition:SENDING', 'ses', 'transition:SENT']);
  });

  it('sends the approved bytes, not a render', async () => {
    await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(mockSendFoiaRequest).toHaveBeenCalledWith(
      expect.objectContaining({ letter: 'APPROVED BYTES' }),
    );
  });

  it('reports SENT with the SES message id', async () => {
    const result = await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(result).toEqual({ status: 'SENT', messageId: 'ses-1', recipient: 'foia@army.mil' });
  });

  /**
   * The unattended path had no audit entry at all.
   *
   * `auditMiddleware` reads context off an HTTP event, and this runs from a cron, so the
   * only record of a filing made in the customer's name was the automation row plus the
   * bytes in S3 — nothing in the log an org's auditors read.
   */
  it('audits an unattended send, marking it as system-originated', async () => {
    await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(mockWriteFoiaSendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        foiaId: 'foia-1',
        sentBy: 'system',
        result: 'success',
        detail: expect.objectContaining({
          recipient: 'foia@army.mil',
          sesMessageId: 'ses-1',
        }),
      }),
    );
  });

  it('records who sent it when a human approved the send', async () => {
    await dispatchFoiaRequest({ automation: automation(), sentBy: 'user-42' });

    expect(mockWriteFoiaSendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ sentBy: 'user-42', result: 'success' }),
    );
  });

  /** A failed attempt at a statutory filing is at least as interesting as a successful one. */
  it('audits a failed send with the error', async () => {
    mockSendFoiaRequest.mockRejectedValue(new Error('SES rejected the message'));

    await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(mockWriteFoiaSendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'failure',
        errorMessage: 'SES rejected the message',
      }),
    );
  });

  it('does not fail the send when stamping the request record fails', async () => {
    // The automation record already says SENT; a bookkeeping failure must not make
    // a delivered filing look undelivered.
    mockUpdateFoiaRequestFields.mockRejectedValue(new Error('dynamo down'));

    const result = await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(result.status).toBe('SENT');
  });
});

describe('dispatchFoiaRequest — never strands the lock', () => {
  it('releases to AWAITING_APPROVAL on a retryable failure', async () => {
    mockSendFoiaRequest.mockRejectedValue(new Error('SES throttled'));

    const result = await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(result).toEqual({ status: 'FAILED', error: 'SES throttled', exhausted: false });
    // Back where a human or the next attempt can pick it up — not stuck.
    expect(transitions()).toEqual(['AWAITING_APPROVAL,STALLED,FAILED->SENDING', 'SENDING->AWAITING_APPROVAL']);
  });

  it('releases to FAILED once the retry cap is reached', async () => {
    // attemptCount 2 + this attempt = 3 = FOIA_MAX_SEND_ATTEMPTS.
    mockSendFoiaRequest.mockRejectedValue(new Error('hard bounce'));

    const result = await dispatchFoiaRequest({
      automation: automation({ attemptCount: 2 }),
      sentBy: 'system',
    });

    expect(result).toEqual({ status: 'FAILED', error: 'hard bounce', exhausted: true });
    expect(transitions()[1]).toBe('SENDING->FAILED');
    // FAILED is a visible failure marker, so the opportunity must reflect it.
    expect(mockSyncMarker).toHaveBeenCalledWith('org-1', 'proj-1', 'opp-1', 'FAILED');
  });

  it('records lastError so the failure is diagnosable', async () => {
    mockSendFoiaRequest.mockRejectedValue(new Error('Email address not verified'));

    await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    const release = mockTransition.mock.calls[1]?.[0] as { patch: { lastError: string } };
    expect(release.patch.lastError).toBe('Email address not verified');
  });

  it('survives a non-Error throw', async () => {
    mockSendFoiaRequest.mockRejectedValue('a bare string');

    const result = await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(result.status).toBe('FAILED');
    expect(transitions()[1]).toBe('SENDING->AWAITING_APPROVAL');
  });

  it('does not throw when even the lock release fails', async () => {
    // Nothing else can release it, so this must be loud but not fatal — throwing
    // would lose the outcome the caller needs to report.
    mockSendFoiaRequest.mockRejectedValue(new Error('SES down'));
    mockTransition.mockImplementation((args: { to: string }) =>
      args.to === 'SENDING'
        ? Promise.resolve({ state: 'SENDING' })
        : Promise.reject(new Error('dynamo down')),
    );

    const result = await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(result.status).toBe('FAILED');
  });
});

describe('dispatchFoiaRequest — refusals', () => {
  it('refuses an unprepared request', async () => {
    const result = await dispatchFoiaRequest({
      automation: automation({ foiaRequestId: null }),
      sentBy: 'system',
    });

    expect(result).toEqual({ status: 'SKIPPED', reason: 'not prepared' });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('refuses once the retry cap is already reached, without burning an attempt', async () => {
    const result = await dispatchFoiaRequest({
      automation: automation({ attemptCount: 3 }),
      sentBy: 'system',
    });

    expect(result).toEqual({ status: 'SKIPPED', reason: 'retry cap reached' });
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockSendFoiaRequest).not.toHaveBeenCalled();
  });

  it('refuses when the request record is missing', async () => {
    mockGetFoiaRequest.mockResolvedValue(null);

    const result = await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(result).toEqual({ status: 'SKIPPED', reason: 'request record missing' });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('treats a lost race as a no-op, not an error', async () => {
    // Two runs cannot both send. Losing means someone else owns it.
    mockTransition.mockResolvedValue(null);

    const result = await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(result).toEqual({ status: 'SKIPPED', reason: 'already sending or sent' });
    expect(mockSendFoiaRequest).not.toHaveBeenCalled();
  });

  it('never lists SENT as a claimable state', async () => {
    // A sent statutory request must never be re-sent, however often this is called.
    await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    const claim = mockTransition.mock.calls[0]?.[0] as { from: string[] };
    expect(claim.from).not.toContain('SENT');
  });
});

describe('dispatchFoiaRequest — letter fallback', () => {
  it('renders when no artifact exists', async () => {
    mockReadFoiaLetterText.mockResolvedValue(null);

    await dispatchFoiaRequest({ automation: automation({ artifacts: [] }), sentBy: 'system' });

    expect(mockSendFoiaRequest).toHaveBeenCalledWith(
      expect.objectContaining({ letter: 'RENDERED FALLBACK' }),
    );
  });

  it('renders rather than stranding the lock when S3 is unreadable', async () => {
    mockReadFoiaLetterText.mockRejectedValue(new Error('access denied'));

    const result = await dispatchFoiaRequest({ automation: automation(), sentBy: 'system' });

    expect(result.status).toBe('SENT');
  });
});
