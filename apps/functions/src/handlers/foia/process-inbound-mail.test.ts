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

/**
 * Builds an SES receipt event for one message.
 *
 * `action` defaults to the Lambda action, which is what SES actually sends. A rule
 * reports the action *currently executing* — the Lambda one — never the earlier S3
 * one, so an `S3`-typed fixture describes an event that cannot occur here.
 */
const sesEvent = (over: {
  subject?: string;
  from?: string;
  destination?: string[];
  messageId?: string;
  action?: Record<string, unknown>;
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
            action: over.action ?? {
              type: 'Lambda',
              functionArn: 'arn:aws:lambda:us-west-2:1234:function:auto-rfp-foia-inbound-Dev',
              invocationType: 'Event',
            },
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

    // Envelope and header recipients are both offered to the lookup, so this
    // asserts containment rather than an exact array.
    expect(mockFindOrgByScrapeMailbox).toHaveBeenCalledWith(
      expect.arrayContaining(['foia@inbox.horustech.dev']),
    );
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

  /**
   * The date the mail arrived is NOT the date the agency awarded.
   *
   * `outcomeDate` is read back by resolveAwardDate and labelled RECORDED_OUTCOME —
   * verified provenance — which both permits "awarded on or about <date>" in the
   * letter and satisfies the unattended-send gate. Writing the receipt-date fallback
   * would launder a guess into a verified award claim through the one path with no
   * human in it. The timer still re-anchors, because an award notice IS evidence an
   * award happened; only the factual assertion is withheld.
   */
  it('does not record the receipt date as the award date when the agency stated none', async () => {
    givenRawMessage(
      rawMessage([
        'Message-ID: <award-nodate@ttuhsc.edu>',
        'Content-Type: text/plain',
        '',
        'Solicitation 739-SL3722874 has been awarded. See the attached notice.',
      ]),
    );

    await processInboundMail(sesEvent({}));

    expect(mockUpdateOpportunity).not.toHaveBeenCalled();

    // But the timer is still re-anchored off the receipt date — a far better clock
    // than the bid deadline, and the letter's hedged wording stays accurate.
    const call = mockSetFoiaAutomationState.mock.calls[0]?.[0];
    expect(call.state).toBe('SCHEDULED');
    expect(call.patch.scheduledSendAt).toBeTruthy();
  });

  it('still records the date when the agency stated one', async () => {
    // The complement of the case above: a stated date is authoritative, so it is
    // recorded and becomes assertable.
    await processInboundMail(sesEvent({}));

    expect(mockUpdateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { outcomeDate: '2026-01-29' } }),
    );
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

describe('locating the stored message', () => {
  /**
   * The production failure, in one test.
   *
   * SES reports the action it is currently executing — `Lambda` — not the earlier
   * `S3` one from the same rule. Keying the S3 lookup off `action.type === 'S3'`
   * therefore never matched, so the raw message was never read: every award was
   * classified from the subject line alone, and the stated award date was silently
   * replaced by the receipt date. Confirmed on a real message, where the body said
   * 1/29/2026 and the opportunity recorded 2026-08-12 — a 195-day error in the one
   * value the whole FOIA schedule is anchored to.
   */
  it('reads the raw message even though SES reports the Lambda action', async () => {
    await processInboundMail(sesEvent({ subject: 'Notification of Award' }));

    expect(mockS3Send).toHaveBeenCalled();
    expect(mockUpdateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { outcomeDate: '2026-01-29' } }),
    );
  });

  it('derives the object key from the SES message id and the rule prefix', async () => {
    // The S3 action names the object after `mail.messageId` under its configured
    // prefix, so the key is reconstructable without the S3 action being reported.
    await processInboundMail(sesEvent({ messageId: 'smtp-id-42' }));

    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          Bucket: 'inbound-bucket',
          Key: 'inbound/smtp-id-42',
        }),
      }),
    );
  });

  it('still prefers an explicit objectKey when SES does report the S3 action', async () => {
    await processInboundMail(
      sesEvent({
        action: { type: 'S3', bucketName: 'inbound-bucket', objectKey: 'inbound/explicit-key' },
      }),
    );

    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ Key: 'inbound/explicit-key' }),
      }),
    );
  });

  it('records the object key it read, so the raw message stays traceable', async () => {
    // Null s3Key on every real ledger row is what exposed the bug.
    await processInboundMail(sesEvent({ messageId: 'smtp-id-7' }));

    expect(mockClaimInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ s3Key: 'inbound/smtp-id-7' }),
    );
  });
});

describe('message id fallback', () => {
  it('falls back to the SES id when the body yields no Message-ID', async () => {
    // A body we cannot parse yields no header. The fallback still dedupes a
    // repeated invocation of the same receipt, which is the retry case that
    // matters here.
    givenRawMessage('unparseable binary garbage with no headers');

    await processInboundMail(sesEvent({ messageId: 'ses-receipt-9' }));

    expect(mockClaimInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'ses-receipt-9' }),
    );
  });

  it('skips entirely when there is no usable id at all', async () => {
    // With nothing to dedupe on, acting could double-apply on a retry.
    givenRawMessage('no headers here');
    const event = sesEvent({});
    const record = event.Records[0] as unknown as {
      ses: { mail: { messageId?: string; commonHeaders: { messageId?: string } } };
    };
    record.ses.mail.messageId = '';
    record.ses.mail.commonHeaders.messageId = '';

    await processInboundMail(event);

    expect(mockClaimInboundMessage).not.toHaveBeenCalled();
  });
});

describe('tenant attribution on forwarded mail', () => {
  /**
   * Regression from the first night of real traffic. Every overnight message was
   * dropped as unattributable: Gmail forwarding preserves the ORIGINAL headers, so
   * `mail.destination` held `proposals@horustech.dev` and `Delivered-To` held the
   * user's own address — our receiving address appeared in neither. SES had
   * accepted the mail for us and said so in `receipt.recipients`, which the handler
   * was ignoring.
   */
  const forwardedEvent = () => {
    const e = sesEvent({});
    const rec = e.Records[0] as unknown as {
      ses: {
        mail: { destination: string[] };
        receipt: { recipients: string[] };
      };
    };
    // Headers carry the original recipients only.
    rec.ses.mail.destination = ['proposals@horustech.dev', 'stevan@horustech.dev'];
    // The envelope is what SES accepted the message for.
    rec.ses.receipt.recipients = ['foia@inbox.horustech.dev'];
    return e;
  };

  it('resolves the org from the SMTP envelope, not the headers', async () => {
    await processInboundMail(forwardedEvent());

    expect(mockFindOrgByScrapeMailbox).toHaveBeenCalledWith(
      expect.arrayContaining(['foia@inbox.horustech.dev']),
    );
    // And it went on to act, rather than dropping the message.
    expect(mockClaimInboundMessage).toHaveBeenCalled();
  });

  it('still consults headers, for wirings that do not populate the envelope', async () => {
    const e = sesEvent({});
    const rec = e.Records[0] as unknown as {
      ses: { mail: { destination: string[] }; receipt: { recipients?: string[] } };
    };
    rec.ses.mail.destination = ['foia@inbox.horustech.dev'];
    delete rec.ses.receipt.recipients;

    await processInboundMail(e);

    expect(mockFindOrgByScrapeMailbox).toHaveBeenCalledWith(
      expect.arrayContaining(['foia@inbox.horustech.dev']),
    );
  });
});
