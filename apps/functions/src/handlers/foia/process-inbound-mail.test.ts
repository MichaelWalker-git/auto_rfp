jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.FOIA_INBOUND_BUCKET = 'inbound-bucket';

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
}));

const mockFindOrgByScrapeMailbox = jest.fn();
const mockGetFoiaSettings = jest.fn();
jest.mock('@/helpers/foia-settings', () => ({
  findOrgByScrapeMailbox: (...a: unknown[]) => mockFindOrgByScrapeMailbox(...a),
  getFoiaSettings: (...a: unknown[]) => mockGetFoiaSettings(...a),
}));

const mockListOpportunitiesByOrg = jest.fn();
const mockUpdateOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  listOpportunitiesByOrg: (...a: unknown[]) => mockListOpportunitiesByOrg(...a),
  updateOpportunity: (...a: unknown[]) => mockUpdateOpportunity(...a),
}));

const mockGetFoiaAutomation = jest.fn();
const mockSetFoiaAutomationState = jest.fn();
const mockSyncOpportunityFoiaMarker = jest.fn();
jest.mock('@/helpers/foia-automation', () => ({
  getFoiaAutomation: (...a: unknown[]) => mockGetFoiaAutomation(...a),
  setFoiaAutomationState: (...a: unknown[]) => mockSetFoiaAutomationState(...a),
  syncOpportunityFoiaMarker: (...a: unknown[]) => mockSyncOpportunityFoiaMarker(...a),
}));

const mockClaimInboundMessage = jest.fn();
jest.mock('@/helpers/foia-mail-ingest', () => {
  const actual = jest.requireActual('@/helpers/foia-mail-ingest');
  return {
    ...actual,
    claimInboundMessage: (...a: unknown[]) => mockClaimInboundMessage(...a),
  };
});

const mockSendNotification = jest.fn();
jest.mock('@/helpers/send-notification', () => ({
  buildNotification: (type: string, title: string, message: string, opts: unknown) => ({
    type,
    title,
    message,
    opts,
  }),
  sendNotification: (...a: unknown[]) => mockSendNotification(...a),
}));

const mockGetOrgMembers = jest.fn();
jest.mock('@/helpers/user', () => ({
  getOrgMembers: (...a: unknown[]) => mockGetOrgMembers(...a),
}));

import { processInboundMail } from './process-inbound-mail';
import type { SESEvent } from 'aws-lambda';

const rawMessage = (lines: string[]): string => lines.join('\r\n');

/** Builds an SES receipt event for one message. */
const sesEvent = (over: {
  subject?: string;
  from?: string;
  destination?: string[];
  messageId?: string;
}): SESEvent =>
  ({
    Records: [
      {
        eventSource: 'aws:ses',
        eventVersion: '1.0',
        ses: {
          mail: {
            timestamp: '2026-08-12T10:00:00.000Z',
            source: over.from ?? 'solicitations@ttuhsc.edu',
            messageId: over.messageId ?? 'ses-receipt-id-1',
            destination: over.destination ?? ['foia@inbox.horustech.dev'],
            headersTruncated: false,
            headers: [],
            commonHeaders: {
              returnPath: over.from ?? 'solicitations@ttuhsc.edu',
              from: [over.from ?? 'solicitations@ttuhsc.edu'],
              date: 'Wed, 12 Aug 2026 10:00:00 +0000',
              to: over.destination ?? ['foia@inbox.horustech.dev'],
              messageId: over.messageId ?? 'ses-receipt-id-1',
              subject: over.subject ?? 'Notification of Award: RFP 739-SL3722874',
            },
          },
          receipt: {
            timestamp: '2026-08-12T10:00:00.000Z',
            processingTimeMillis: 100,
            recipients: over.destination ?? ['foia@inbox.horustech.dev'],
            spamVerdict: { status: 'PASS' },
            virusVerdict: { status: 'PASS' },
            spfVerdict: { status: 'PASS' },
            dkimVerdict: { status: 'PASS' },
            dmarcVerdict: { status: 'PASS' },
            action: { type: 'S3', bucketName: 'inbound-bucket', objectKey: 'inbound/msg-1' },
          },
        },
      },
    ],
  }) as unknown as SESEvent;

/** Points the mocked S3 read at a given raw message. */
const givenRawMessage = (raw: string) => {
  mockS3Send.mockResolvedValue({ Body: { transformToString: async () => raw } });
};

const TX_OPPORTUNITY = {
  oppId: 'opp-tx',
  id: 'opp-tx',
  orgId: 'org-horus',
  projectId: 'proj-1',
  solicitationNumber: 'RFP 739-SL3722874',
  title: 'Student Prospect Digital Profile Solution',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOrgByScrapeMailbox.mockResolvedValue('org-horus');
  mockListOpportunitiesByOrg.mockResolvedValue({ items: [TX_OPPORTUNITY] });
  mockGetFoiaSettings.mockResolvedValue({ orgId: 'org-horus', delayDays: 90 });
  mockGetFoiaAutomation.mockResolvedValue({ state: 'SCHEDULED' });
  mockSetFoiaAutomationState.mockResolvedValue(undefined);
  mockSyncOpportunityFoiaMarker.mockResolvedValue(undefined);
  mockUpdateOpportunity.mockResolvedValue(undefined);
  mockClaimInboundMessage.mockResolvedValue(true);
  mockGetOrgMembers.mockResolvedValue([{ userId: 'u1', email: 'u1@horustech.dev' }]);
  mockSendNotification.mockResolvedValue(undefined);
  givenRawMessage(
    rawMessage([
      'Message-ID: <award-1@ttuhsc.edu>',
      'Content-Type: text/plain',
      '',
      'Solicitation ID: 739-SL3722874 Status: Awarded Award Date 1/29/2026',
    ]),
  );
});

describe('tenant attribution', () => {
  it('ignores mail no org claims', async () => {
    // Inbound mail carries no tenant. Without attribution, a write in the shared
    // table could put one customer's correspondence on another's opportunity.
    mockFindOrgByScrapeMailbox.mockResolvedValue(null);

    await processInboundMail(sesEvent({}));

    expect(mockClaimInboundMessage).not.toHaveBeenCalled();
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('resolves the org from the recipient address', async () => {
    await processInboundMail(sesEvent({ destination: ['foia@inbox.horustech.dev'] }));

    expect(mockFindOrgByScrapeMailbox).toHaveBeenCalledWith(['foia@inbox.horustech.dev']);
  });
});

describe('award notices', () => {
  it('records the agency-stated award date and re-anchors the timer', async () => {
    await processInboundMail(sesEvent({}));

    // The award date the agency stated, not the receipt date.
    expect(mockUpdateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-horus',
        projectId: 'proj-1',
        oppId: 'opp-tx',
        patch: { outcomeDate: '2026-01-29' },
      }),
    );

    // Re-anchored 90 days after the real award, not after the bid deadline.
    const call = mockSetFoiaAutomationState.mock.calls[0]?.[0];
    expect(call.state).toBe('SCHEDULED');
    expect(call.patch.scheduledSendAt.slice(0, 10)).toBe('2026-04-29');
  });

  it('notifies the org so an automated decision is never invisible', async () => {
    await processInboundMail(sesEvent({}));

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'AWARD_DETECTED' }),
    );
  });

  it('does not move a request that has already been sent', async () => {
    // A sent request cannot be rescheduled; doing so would misreport history.
    mockGetFoiaAutomation.mockResolvedValue({ state: 'SENT' });

    await processInboundMail(sesEvent({}));

    expect(mockSetFoiaAutomationState).not.toHaveBeenCalled();
    // The award date is still recorded — that is a fact about the procurement.
    expect(mockUpdateOpportunity).toHaveBeenCalled();
  });
});

describe('cancellations', () => {
  it('suppresses a pending automation', async () => {
    givenRawMessage(
      rawMessage([
        'Message-ID: <cancel-1@ttuhsc.edu>',
        'Content-Type: text/plain',
        '',
        'Solicitation RFP 739-SL3722874 has been cancelled and no award will be made.',
      ]),
    );

    await processInboundMail(sesEvent({ subject: 'Cancellation of Solicitation' }));

    const call = mockSetFoiaAutomationState.mock.calls[0]?.[0];
    expect(call.state).toBe('SUPPRESSED');
    expect(call.patch.suppressionReason).toBe('SOLICITATION_CANCELLED');
  });

  it('leaves a sent request alone', async () => {
    mockGetFoiaAutomation.mockResolvedValue({ state: 'SENT' });
    givenRawMessage(
      rawMessage([
        'Message-ID: <cancel-2@ttuhsc.edu>',
        'Content-Type: text/plain',
        '',
        'Solicitation RFP 739-SL3722874 has been cancelled.',
      ]),
    );

    await processInboundMail(sesEvent({ subject: 'Cancellation of Solicitation' }));

    expect(mockSetFoiaAutomationState).not.toHaveBeenCalled();
  });
});

describe('agency replies', () => {
  it('records the outcome without changing the lifecycle state', async () => {
    mockGetFoiaAutomation.mockResolvedValue({ state: 'SENT' });
    givenRawMessage(
      rawMessage([
        'Message-ID: <reply-1@ttuhsc.edu>',
        'Content-Type: text/plain',
        '',
        'Texas Tech University is in receipt of your open records request below. ' +
          "Please note that no record of Horus Technology's participation in this solicitation was located.",
      ]),
    );

    await processInboundMail(
      sesEvent({
        from: 'Barclay.White@ttuhsc.edu',
        subject: 'RE: Texas Public Information Act Request — RFP 739-SL3722874',
      }),
    );

    const call = mockSetFoiaAutomationState.mock.calls[0]?.[0];
    // SENT is preserved: a reply says what came back, not where the request is.
    expect(call.state).toBe('SENT');
    expect(call.patch.responseOutcome).toBe('NO_RECORDS_LOCATED');
  });

  it('does not notify on a reply', async () => {
    // Replies are visible on the opportunity; notifying on every message would
    // train people to ignore the channel.
    mockGetFoiaAutomation.mockResolvedValue({ state: 'SENT' });
    givenRawMessage(
      rawMessage([
        'Message-ID: <reply-2@ttuhsc.edu>',
        'Content-Type: text/plain',
        '',
        'In further response to your Public Records Act request for RFP 739-SL3722874.',
      ]),
    );

    await processInboundMail(sesEvent({ subject: 'Response: RFP 739-SL3722874' }));

    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});

describe('deduplication', () => {
  it('keys the claim on the RFC Message-ID, not the SES receipt id', async () => {
    // SES assigns a fresh receipt id per delivery, so keying on that would let a
    // retry through twice.
    await processInboundMail(sesEvent({ messageId: 'ses-receipt-id-1' }));

    expect(mockClaimInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: '<award-1@ttuhsc.edu>' }),
    );
  });

  it('applies nothing when the message was already processed', async () => {
    mockClaimInboundMessage.mockResolvedValue(false);

    await processInboundMail(sesEvent({}));

    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    expect(mockSetFoiaAutomationState).not.toHaveBeenCalled();
  });
});

describe('failure handling', () => {
  it('still classifies when the raw message cannot be read', async () => {
    // The S3 store action runs before this Lambda, so the object should exist —
    // but a read failure must not crash ingestion. Headers alone still classify.
    mockS3Send.mockRejectedValue(new Error('access denied'));

    await expect(processInboundMail(sesEvent({}))).resolves.toBeUndefined();

    expect(mockClaimInboundMessage).toHaveBeenCalled();
  });

  it('does not rethrow an apply failure into a pointless SES retry', async () => {
    // The claim is already written, so a retry would skip the message anyway.
    mockUpdateOpportunity.mockRejectedValue(new Error('dynamo down'));

    await expect(processInboundMail(sesEvent({}))).resolves.toBeUndefined();
  });

  it('ignores unrelated commercial mail without touching anything', async () => {
    givenRawMessage(
      rawMessage([
        'Message-ID: <news-1@vendor.com>',
        'Content-Type: text/plain',
        '',
        'Join our webinar on cloud migration.',
      ]),
    );

    await processInboundMail(
      sesEvent({ from: 'newsletter@vendor.com', subject: 'Our latest webinar' }),
    );

    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    expect(mockSetFoiaAutomationState).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
