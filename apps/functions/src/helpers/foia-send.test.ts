process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.SES_FROM_EMAIL = 'noreply@horustech.dev';
process.env.FOIA_SES_CONFIGURATION_SET = 'auto-rfp-foia-dev';
process.env.REGION = 'us-east-1';

const mockSesSend = jest.fn();
jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn(() => ({ send: mockSesSend })),
  SendRawEmailCommand: jest.fn((params) => ({ type: 'SendRawEmail', params })),
}));

const mockGetFileBuffer = jest.fn();
jest.mock('@/helpers/s3', () => ({
  getFileBufferFromS3: (...a: unknown[]) => mockGetFileBuffer(...a),
}));

import type { DBFOIARequestItem } from '@/types/project-outcome';

import { buildFoiaMimeMessage, sendFoiaRequest } from './foia-send';

const buildRequest = (over: Partial<DBFOIARequestItem> = {}): DBFOIARequestItem =>
  ({
    partition_key: 'FOIA_REQUEST',
    sort_key: 'o#p#x#foia-1',
    foiaId: 'foia-1',
    id: 'foia-1',
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    agencyName: 'Department of the Army',
    agencyFOIAEmail: 'foia@army.mil',
    agencyFOIAAddress: '9301 Chapek Rd',
    solicitationNumber: 'W912-24-R-0001',
    contractTitle: 'Widget Support',
    requestedDocuments: ['SSDD'],
    customDocumentRequests: [],
    feeLimit: 0,
    companyName: 'Acme Corp',
    awardDate: '2026-03-01',
    requesterName: 'Jane Doe',
    requesterTitle: 'VP Contracts',
    requesterEmail: 'jane@acme.com',
    requesterPhone: '555-0100',
    requesterAddress: '1 Acme Way',
    requestedBy: 'system',
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as DBFOIARequestItem;

const headersOf = (mime: string): string[] => mime.split('\r\n\r\n')[0]!.split('\r\n');

beforeEach(() => {
  jest.clearAllMocks();
  mockSesSend.mockResolvedValue({ MessageId: 'ses-msg-1' });
  mockGetFileBuffer.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
});

describe('buildFoiaMimeMessage — headers', () => {
  it('sends from our domain but replies to the customer', () => {
    const mime = buildFoiaMimeMessage({
      request: buildRequest(),
      letter: 'Body',
      subject: 'FOIA Request',
    });

    // From must be our verified domain for DKIM alignment; Reply-To carries the
    // customer so the agency's response reaches them, not our no-reply box.
    expect(mime).toContain('<noreply@horustech.dev>');
    expect(mime).toContain('Reply-To: jane@acme.com');
    expect(mime).toContain('To: foia@army.mil');
  });

  it('identifies the requester and company in the From display name', () => {
    const mime = buildFoiaMimeMessage({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
    });

    expect(mime).toContain('From: Jane Doe (Acme Corp) via AutoRFP <noreply@horustech.dev>');
  });

  it('copies the customer when a cc is supplied', () => {
    const mime = buildFoiaMimeMessage({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
      ccEmail: 'signer@acme.com',
    });

    expect(mime).toContain('Cc: signer@acme.com');
  });

  it('neutralizes a CRLF-injected header in the agency address', () => {
    const mime = buildFoiaMimeMessage({
      request: buildRequest({ agencyFOIAEmail: 'foia@army.mil\r\nBcc: attacker@evil.com' }),
      letter: 'B',
      subject: 'S',
    });

    const headers = headersOf(mime);
    expect(headers.some((h) => h.startsWith('Bcc:'))).toBe(false);
  });

  it('never emits more headers than the template defines', () => {
    const mime = buildFoiaMimeMessage({
      request: buildRequest({
        agencyFOIAEmail: 'a@b.mil\r\nBcc: x@y.com',
        requesterName: 'N\r\nX-Evil: 1',
        requesterEmail: 'e@f.com\r\nX-Other: 2',
      }),
      letter: 'B',
      subject: 'S\r\nX-Third: 3',
    });

    // From, To, Reply-To, Subject, MIME-Version, Content-Type = 6.
    expect(headersOf(mime)).toHaveLength(6);
  });

  it('RFC 2047-encodes a non-ASCII subject', () => {
    const mime = buildFoiaMimeMessage({
      request: buildRequest(),
      letter: 'B',
      subject: 'FOIA Request — Solicitation',
    });

    // An em dash must not go out as raw 8-bit in a header.
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it('leaves a plain ASCII subject unencoded', () => {
    const mime = buildFoiaMimeMessage({
      request: buildRequest(),
      letter: 'B',
      subject: 'FOIA Request W912',
    });

    expect(mime).toContain('Subject: FOIA Request W912');
  });
});

describe('buildFoiaMimeMessage — body and attachments', () => {
  it('puts the letter in a plain-text part', () => {
    const mime = buildFoiaMimeMessage({
      request: buildRequest(),
      letter: 'Dear FOIA Officer,\r\n\r\nPlease provide...',
      subject: 'S',
    });

    expect(mime).toContain('Content-Type: text/plain; charset="utf-8"');
    expect(mime).toContain('Dear FOIA Officer,');
  });

  it('attaches a PDF as base64 with a filename', () => {
    const mime = buildFoiaMimeMessage({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
      attachments: [
        { fileName: 'FOIA_Request.pdf', contentType: 'application/pdf', content: Buffer.from('pdfdata') },
      ],
    });

    expect(mime).toContain('Content-Disposition: attachment; filename="FOIA_Request.pdf"');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    expect(mime).toContain(Buffer.from('pdfdata').toString('base64'));
  });

  it('wraps long base64 at 76 characters, as MIME requires', () => {
    const big = Buffer.alloc(500, 0x41);
    const mime = buildFoiaMimeMessage({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
      attachments: [{ fileName: 'a.pdf', contentType: 'application/pdf', content: big }],
    });

    const b64Lines = mime
      .split('\r\n')
      .filter((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l));
    expect(b64Lines.length).toBeGreaterThan(1);
    for (const line of b64Lines) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('closes the multipart envelope', () => {
    const mime = buildFoiaMimeMessage({ request: buildRequest(), letter: 'B', subject: 'S' });
    const boundary = /boundary="([^"]+)"/.exec(mime)![1]!;

    expect(mime.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it('produces a deterministic boundary, so the output is testable', () => {
    const a = buildFoiaMimeMessage({ request: buildRequest(), letter: 'B', subject: 'S' });
    const b = buildFoiaMimeMessage({ request: buildRequest(), letter: 'B', subject: 'S' });

    expect(a).toBe(b);
  });
});

describe('sendFoiaRequest', () => {
  it('sends and returns the SES message id', async () => {
    const result = await sendFoiaRequest({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
    });

    expect(result.messageId).toBe('ses-msg-1');
    expect(result.recipient).toBe('foia@army.mil');
    expect(mockSesSend).toHaveBeenCalledTimes(1);
  });

  it('names the configuration set, so bounces are captured', async () => {
    await sendFoiaRequest({ request: buildRequest(), letter: 'B', subject: 'S' });

    const [command] = mockSesSend.mock.calls[0]! as [{ params: Record<string, unknown> }];
    // Without this a rejected statutory request looks exactly like a delivered one.
    expect(command.params.ConfigurationSetName).toBe('auto-rfp-foia-dev');
  });

  it('includes the cc in the SES destination list, not just the header', async () => {
    await sendFoiaRequest({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
      ccEmail: 'signer@acme.com',
    });

    const [command] = mockSesSend.mock.calls[0]! as [{ params: { Destinations: string[] } }];
    // A Cc header alone does not deliver — SES sends only to Destinations.
    expect(command.params.Destinations).toEqual(['foia@army.mil', 'signer@acme.com']);
  });

  it('fetches and attaches the persisted PDF', async () => {
    const result = await sendFoiaRequest({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
      artifacts: [
        {
          kind: 'LETTER_PDF',
          s3Key: 'org/proj/opp/foia/f1/letter.pdf',
          fileName: 'letter.pdf',
          contentType: 'application/pdf',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(mockGetFileBuffer).toHaveBeenCalledWith('test-bucket', 'org/proj/opp/foia/f1/letter.pdf');
    expect(result.attached).toEqual(['letter.pdf']);
  });

  it('still sends text-only when the PDF cannot be fetched', async () => {
    mockGetFileBuffer.mockRejectedValue(new Error('s3 404'));

    const result = await sendFoiaRequest({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
      artifacts: [
        {
          kind: 'LETTER_PDF',
          s3Key: 'missing.pdf',
          fileName: 'letter.pdf',
          contentType: 'application/pdf',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    // The letter body carries the request; the PDF is a convenience.
    expect(result.messageId).toBe('ses-msg-1');
    expect(result.attached).toEqual([]);
  });

  it('ignores non-PDF artifacts when choosing attachments', async () => {
    const result = await sendFoiaRequest({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
      artifacts: [
        { kind: 'LETTER_TXT', s3Key: 'a.txt', fileName: 'a.txt', contentType: 'text/plain', createdAt: '2026-01-01T00:00:00.000Z' },
        { kind: 'EML', s3Key: 'a.eml', fileName: 'a.eml', contentType: 'message/rfc822', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    });

    // The text is already the body, and the .eml is for the customer's own records.
    expect(result.attached).toEqual([]);
  });

  it('does not call SES on a dry run', async () => {
    const result = await sendFoiaRequest({
      request: buildRequest(),
      letter: 'B',
      subject: 'S',
      dryRun: true,
    });

    expect(mockSesSend).not.toHaveBeenCalled();
    expect(result.messageId).toBe('dry-run');
  });

  it('throws when there is no agency address', async () => {
    await expect(
      sendFoiaRequest({ request: buildRequest({ agencyFOIAEmail: '' }), letter: 'B', subject: 'S' }),
    ).rejects.toThrow(/no agency email/i);
  });

  it('throws when SES returns no message id', async () => {
    mockSesSend.mockResolvedValue({});

    // Without an id the send cannot be correlated to a bounce later, so treating
    // it as success would create an untrackable filing.
    await expect(
      sendFoiaRequest({ request: buildRequest(), letter: 'B', subject: 'S' }),
    ).rejects.toThrow(/MessageId/);
  });

  it('propagates an SES failure so the caller can record FAILED', async () => {
    mockSesSend.mockRejectedValue(new Error('Throttling'));

    await expect(
      sendFoiaRequest({ request: buildRequest(), letter: 'B', subject: 'S' }),
    ).rejects.toThrow('Throttling');
  });
});
