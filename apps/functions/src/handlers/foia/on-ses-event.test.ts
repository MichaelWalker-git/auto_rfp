/**
 * Tests for the FOIA bounce handler.
 *
 * This was the only one of the FOIA handlers with no test, and it is the one that makes
 * unattended sending safe to enable: without it a rejected statutory request is
 * indistinguishable from a delivered one — SES accepts the message, the record says SENT,
 * and the statutory deadline passes with nobody aware.
 */
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  GetCommand: jest.fn(),
  QueryCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

const mockListAutomations = jest.fn();
const mockTransition = jest.fn();
const mockSyncMarker = jest.fn();
jest.mock('@/helpers/foia-automation', () => ({
  listFoiaAutomationsForScan: (...a: unknown[]) => mockListAutomations(...a),
  transitionFoiaAutomationState: (...a: unknown[]) => mockTransition(...a),
  syncOpportunityFoiaMarker: (...a: unknown[]) => mockSyncMarker(...a),
}));

const mockMarkBounced = jest.fn();
jest.mock('@/helpers/foia-agency-contact', () => ({
  markAgencyContactBounced: (...a: unknown[]) => mockMarkBounced(...a),
}));

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...a: unknown[]) => mockGetOpportunity(...a),
}));

const mockSendNotification = jest.fn();
jest.mock('@/helpers/send-notification', () => ({
  buildNotification: jest.fn(() => ({ subject: 's', body: 'b' })),
  sendNotification: (...a: unknown[]) => mockSendNotification(...a),
}));

jest.mock('@/helpers/user', () => ({
  getOrgMembers: jest.fn(async () => [{ email: 'admin@acme.test', role: 'ADMIN' }]),
}));

import { baseHandler } from './on-ses-event';

/** An SNS envelope wrapping an SES event notification, as SES actually delivers it. */
const snsEvent = (message: unknown) =>
  ({
    Records: [{ Sns: { Message: typeof message === 'string' ? message : JSON.stringify(message) } }],
  }) as Parameters<typeof baseHandler>[0];

const automation = (over: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  projectId: 'proj-1',
  oppId: 'opp-1',
  state: 'SENT',
  sesMessageId: 'ses-msg-1',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockListAutomations.mockResolvedValue([automation()]);
  mockTransition.mockResolvedValue({ state: 'BOUNCED' });
  mockSyncMarker.mockResolvedValue(undefined);
  mockMarkBounced.mockResolvedValue(undefined);
  mockGetOpportunity.mockResolvedValue({ item: { organizationName: 'DEPT OF THE ARMY' } });
  mockSendNotification.mockResolvedValue(undefined);
});

describe('on-ses-event — bounces', () => {
  it('moves a bounced request from SENT to BOUNCED with the diagnostic', async () => {
    const res = await baseHandler(
      snsEvent({
        eventType: 'Bounce',
        mail: { messageId: 'ses-msg-1' },
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'NoEmail',
          bouncedRecipients: [
            { emailAddress: 'foia@army.mil', diagnosticCode: '550 5.1.1 user unknown' },
          ],
        },
      }),
    );

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'SENT',
        to: 'BOUNCED',
        patch: expect.objectContaining({
          bounceReason: 'Permanent/NoEmail: 550 5.1.1 user unknown',
        }),
      }),
    );
    expect(res.matched).toBe(1);
  });

  /**
   * Without this the next opportunity for the same agency resolves to the same dead
   * mailbox and fails identically, forever.
   */
  it('flags the agency contact so the dead address is not reused', async () => {
    await baseHandler(
      snsEvent({
        eventType: 'Bounce',
        mail: { messageId: 'ses-msg-1' },
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ status: '5.1.1' }] },
      }),
    );

    expect(mockMarkBounced).toHaveBeenCalledWith(
      'org-1',
      expect.any(String),
      expect.stringContaining('Permanent'),
    );
  });

  it('notifies the org so a failed statutory filing is visible', async () => {
    await baseHandler(
      snsEvent({
        eventType: 'Bounce',
        mail: { messageId: 'ses-msg-1' },
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ status: '5.1.1' }] },
      }),
    );

    expect(mockSendNotification).toHaveBeenCalled();
  });

  it('treats a complaint as a failure', async () => {
    await baseHandler(
      snsEvent({
        eventType: 'Complaint',
        mail: { messageId: 'ses-msg-1' },
        complaint: { complaintFeedbackType: 'abuse' },
      }),
    );

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'BOUNCED', patch: expect.objectContaining({ bounceReason: 'Complaint: abuse' }) }),
    );
  });

  /** Older SNS-direct notifications use `notificationType` rather than `eventType`. */
  it('accepts the legacy notificationType field', async () => {
    await baseHandler(
      snsEvent({
        notificationType: 'Bounce',
        mail: { messageId: 'ses-msg-1' },
        bounce: { bounceType: 'Transient', bouncedRecipients: [{ status: '4.4.1' }] },
      }),
    );

    expect(mockTransition).toHaveBeenCalled();
  });
});

describe('on-ses-event — events that must not change state', () => {
  it('logs a delivery without touching the record', async () => {
    await baseHandler(snsEvent({ eventType: 'Delivery', mail: { messageId: 'ses-msg-1' } }));

    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockListAutomations).not.toHaveBeenCalled();
  });

  it('ignores an unrelated event type', async () => {
    await baseHandler(snsEvent({ eventType: 'Open', mail: { messageId: 'ses-msg-1' } }));

    expect(mockTransition).not.toHaveBeenCalled();
  });

  /**
   * A record already cancelled or manually completed must not be dragged backwards into
   * BOUNCED — the conditional transition is what enforces that, and a lost race is a
   * no-op rather than an error.
   */
  it('leaves a record that is no longer SENT alone', async () => {
    mockListAutomations.mockResolvedValue([automation({ state: 'MANUAL_COMPLETED' })]);
    mockTransition.mockResolvedValue(null);

    const res = await baseHandler(
      snsEvent({
        eventType: 'Bounce',
        mail: { messageId: 'ses-msg-1' },
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ status: '5.1.1' }] },
      }),
    );

    expect(mockSyncMarker).not.toHaveBeenCalled();
    expect(mockMarkBounced).not.toHaveBeenCalled();
    expect(res.matched).toBe(1);
  });
});

describe('on-ses-event — malformed and uncorrelatable input', () => {
  /** SNS can deliver anything; an unparseable body must not throw and fail the batch. */
  it('skips an unparseable SNS message without throwing', async () => {
    const res = await baseHandler(snsEvent('not json at all'));

    expect(res.handled).toBe(0);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('skips an event with no messageId to correlate on', async () => {
    const res = await baseHandler(
      snsEvent({ eventType: 'Bounce', bounce: { bounceType: 'Permanent' } }),
    );

    expect(res.handled).toBe(1);
    expect(res.matched).toBe(0);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('reports no match when no automation carries that SES message id', async () => {
    mockListAutomations.mockResolvedValue([automation({ sesMessageId: 'some-other-id' })]);

    const res = await baseHandler(
      snsEvent({
        eventType: 'Bounce',
        mail: { messageId: 'ses-msg-1' },
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ status: '5.1.1' }] },
      }),
    );

    expect(res.matched).toBe(0);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  /** A missing diagnostic is normal; the reason must still be recorded, not crash. */
  it('records a bounce with no diagnostic detail', async () => {
    await baseHandler(
      snsEvent({ eventType: 'Bounce', mail: { messageId: 'ses-msg-1' }, bounce: {} }),
    );

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          bounceReason: 'Bounce/unknown: no diagnostic returned',
        }),
      }),
    );
  });

  /** Flagging the contact is best-effort: it must never lose the state transition. */
  it('still bounces the record when the opportunity read fails', async () => {
    mockGetOpportunity.mockRejectedValue(new Error('dynamo down'));

    const res = await baseHandler(
      snsEvent({
        eventType: 'Bounce',
        mail: { messageId: 'ses-msg-1' },
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ status: '5.1.1' }] },
      }),
    );

    expect(mockTransition).toHaveBeenCalled();
    expect(res.matched).toBe(1);
  });
});
