process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
}));

const mockCreateItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  createItem: (...a: unknown[]) => mockCreateItem(...a),
}));

import {
  awardDateFromMail,
  buildMailScanSk,
  claimInboundMessage,
  decideInboundMail,
  readResponseOutcome,
  toCorrelationCandidates,
} from './foia-mail-ingest';
import type { OpportunityDBItem } from '@auto-rfp/core';

const raw = (lines: string[]): string => lines.join('\r\n');

const KNOWN = [
  { oppId: 'opp-tx', orgId: 'org-1', projectId: 'proj-1', solicitationNumber: 'RFP 739-SL3722874' },
  { oppId: 'opp-ca', orgId: 'org-1', projectId: 'proj-1', solicitationNumber: 'IFB C25910004' },
  { oppId: 'opp-sb', orgId: 'org-1', projectId: 'proj-1', solicitationNumber: 'RFP No. 26-16' },
  { oppId: 'opp-va', orgId: 'org-1', projectId: 'proj-1', solicitationNumber: '36C24826Q0460' },
];

const decide = (from: string, subject: string, body = '') =>
  decideInboundMail({
    from,
    subject,
    raw: raw(['Content-Type: text/plain', '', body]),
    candidates: KNOWN,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateItem.mockResolvedValue(undefined);
});

describe('decideInboundMail — real correspondence', () => {
  it('records an award from a real state-university notice', () => {
    const result = decide(
      'solicitations@ttuhsc.edu',
      'Notification of Award: RFP 739-SL3722874 - Student Prospect Digital Profile Solution',
      'Solicitation ID: 739-SL3722874 Status: Awarded Award Date 1/29/2026',
    );

    expect(result.action).toBe('AWARD_RECORDED');
    expect(result.match?.candidate.oppId).toBe('opp-tx');
  });

  it('treats our own outbound request as ours, never as a trigger', () => {
    const result = decide(
      'brennen@horustech.dev',
      'Texas Public Information Act Request — RFP 739-SL3722874, Student Prospect',
      'This email constitutes a formal request for public information under the Texas Public Information Act.',
    );

    expect(result.action).toBe('OWN_REQUEST_LOGGED');
  });

  it('attaches a real agency reply to the correlated opportunity', () => {
    const result = decide(
      'Barclay.White@ttuhsc.edu',
      'RE: Texas Public Information Act Request — RFP 739-SL3722874',
      'Texas Tech University is in receipt of your open records request below. ' +
        'Pursuant to said request, please see the attached responsive documents.',
    );

    expect(result.action).toBe('RESPONSE_ATTACHED');
    expect(result.match?.candidate.oppId).toBe('opp-tx');
  });

  it('correlates a terse reply that has almost no body', () => {
    const result = decide('records@dgs.ca.gov', 'PRA 26-528 - Response - 07.17.26', '');

    // No solicitation number anywhere, so it cannot be attached — but it is still
    // recognised as a reply rather than silently dropped.
    expect(result.action).toBe('FLAGGED_FOR_REVIEW');
    expect(result.classification.trackingNumber).toBe('26-528');
  });

  it('correlates a reply whose only identifier is in the subject', () => {
    const result = decide(
      'purchasing@sbcusd.k12.ca.us',
      'Response: RFP No. 26-16, AI-Powered Student Attendance Platform (07.09.26)',
      '',
    );

    expect(result.action).toBe('RESPONSE_ATTACHED');
    expect(result.match?.candidate.oppId).toBe('opp-sb');
  });

  it('suppresses the automation on a real cancellation', () => {
    const result = decide(
      'contracting@va.gov',
      'Cancellation of Solicitation 36C24826Q0460',
      'The solicitation has been cancelled and no award will be made.',
    );

    expect(result.action).toBe('SUPPRESSED');
    expect(result.match?.candidate.oppId).toBe('opp-va');
  });

  it('ignores ordinary commercial mail', () => {
    const result = decide('newsletter@vendor.com', 'Our latest webinar', 'Join us to learn.');

    expect(result.action).toBe('IGNORED');
  });
});

describe('decideInboundMail — refusals', () => {
  it('refuses to act when several opportunities match', () => {
    // An amendment covering two solicitations. Acting on the first would attach an
    // award to the wrong opportunity and file against the wrong agency.
    const result = decideInboundMail({
      from: 'x@agency.gov',
      subject: 'Award Notice',
      raw: raw([
        'Content-Type: text/plain',
        '',
        'Awards for RFP 739-SL3722874 and IFB C25910004 have been made.',
      ]),
      candidates: KNOWN,
    });

    expect(result.action).toBe('FLAGGED_FOR_REVIEW');
    expect(result.ambiguousMatches).toHaveLength(2);
  });

  it('refuses to record an award with no correlatable opportunity', () => {
    const result = decide(
      'x@agency.gov',
      'Award Notice: Some Other Contract',
      'An award has been made for W912DY-99-R-9999.',
    );

    expect(result.action).toBe('FLAGGED_FOR_REVIEW');
    expect(result.match).toBeUndefined();
  });

  it('refuses to record an award with no identifier at all', () => {
    const result = decide('x@agency.gov', 'Contract award posted', 'An award notice was published.');

    expect(result.action).toBe('FLAGGED_FOR_REVIEW');
  });

  it('extracts attachment names from a real multipart reply', () => {
    const result = decideInboundMail({
      from: 'Barclay.White@ttuhsc.edu',
      subject: 'RE: Public Information Act Request — RFP 739-SL3722874',
      raw: raw([
        'Content-Type: multipart/mixed; boundary="B1"',
        '',
        '--B1',
        'Content-Type: text/plain',
        '',
        'Please see the attached responsive documents.',
        '--B1',
        'Content-Type: application/pdf; name="Evaluation Sheet.pdf"',
        'Content-Disposition: attachment; filename="Evaluation Sheet.pdf"',
        '',
        'JVBERi0=',
        '--B1--',
      ]),
      candidates: KNOWN,
    });

    expect(result.action).toBe('RESPONSE_ATTACHED');
    expect(result.attachmentNames).toEqual(['Evaluation Sheet.pdf']);
  });
});

describe('readResponseOutcome — what the agency actually did', () => {
  const outcome = (bodyText: string, attachmentNames: string[] = []) =>
    readResponseOutcome({
      classification: { classification: 'FOIA_RESPONSE', confidence: 'HIGH', matchedOn: [] },
      bodyText,
      attachmentNames,
    });

  it('reads the real "no record located" reply', () => {
    // Verbatim from TTUHSC. This fact exists only in the reply text — it is how we
    // learn the agency has no record of us bidding a solicitation we believed we
    // bid, and nothing downstream can reconstruct it later.
    expect(
      outcome("Please note that no record of Horus Technology's participation in this solicitation was located."),
    ).toBe('NO_RECORDS_LOCATED');
  });

  it('prefers "no records located" over attached records', () => {
    // A reply can produce partial records while stating none were found for us.
    // The second fact is the one that matters.
    expect(
      outcome('Please see the attached responsive documents. However, no records were located for your firm.', [
        'Evaluation.pdf',
      ]),
    ).toBe('NO_RECORDS_LOCATED');
  });

  it('reads records received from an attachment', () => {
    expect(outcome('Attached please find the responsive records.', ['Recommendation.pdf'])).toBe(
      'RECORDS_RECEIVED',
    );
  });

  it('reads records received from the wording alone', () => {
    expect(outcome('Pursuant to said request, please see the attached responsive documents.')).toBe(
      'RECORDS_RECEIVED',
    );
  });

  it('reads a denial the agency states about itself', () => {
    expect(outcome('We are withholding the remaining records under Government Code 6254.')).toBe(
      'DENIED',
    );
    expect(outcome('Your request is denied in its entirety.')).toBe('DENIED');
    expect(outcome('The records are exempt from disclosure under the deliberative process privilege.')).toBe('DENIED');
  });

  it('does not read our own letter\'s exemption clause as a denial', () => {
    /**
     * Found on the first real forwarded message. Our request letter asks the
     * agency to "identify the specific exemption claimed for each withheld
     * portion" — quoted back in every forwarded reply. A bare `withheld` match
     * fired on that, labelling a response that ATTACHED a contractor ranking, a
     * notice of selection and a competitor proposal as DENIED.
     */
    const ourClause =
      'If any portion of a requested record is withheld as exempt, please identify ' +
      'the specific exemption claimed for each withheld portion.';

    expect(outcome(ourClause)).toBe('ACKNOWLEDGED');
    // And with records attached, it is unambiguously a production.
    expect(outcome(ourClause, ['Contractor Ranking.xlsx'])).toBe('RECORDS_RECEIVED');
  });

  it('treats a redacted attachment as records received, not a denial', () => {
    // Redaction is partial disclosure. Agencies redact routinely, so reading it as
    // a denial would mislabel a large share of real replies.
    expect(outcome('Please see the attached.', ['Terra Compliance, LLC_Redacted.pdf'])).toBe(
      'RECORDS_RECEIVED',
    );
  });

  it('reads a Texas AG referral as a denial', () => {
    // Under the TPIA an agency withholding must refer to the Attorney General, so
    // a referral is the shape a denial takes in that jurisdiction.
    expect(
      outcome('We have referred this matter to the Texas Attorney General for a ruling.'),
    ).toBe('DENIED');
  });

  it('falls back to acknowledged when nothing has been produced yet', () => {
    expect(outcome('We have received your request and are processing it.')).toBe('ACKNOWLEDGED');
  });
});

describe('decideInboundMail — response outcomes', () => {
  it('records the outcome on an attached reply', () => {
    const result = decideInboundMail({
      from: 'Barclay.White@ttuhsc.edu',
      subject: 'RE: Texas Public Information Act Request — RFP 739-SL3722874',
      raw: raw([
        'Content-Type: text/plain',
        '',
        'Texas Tech University is in receipt of your open records request below. ' +
          "Please note that no record of Horus Technology's participation in this solicitation was located.",
      ]),
      candidates: KNOWN,
    });

    expect(result.action).toBe('RESPONSE_ATTACHED');
    expect(result.responseOutcome).toBe('NO_RECORDS_LOCATED');
  });

  it('records an outcome even when the reply cannot be correlated', () => {
    // Still worth knowing what happened; a human links it to an opportunity.
    const result = decideInboundMail({
      from: 'records@dgs.ca.gov',
      subject: 'PRA 26-528 - Response - 07.17.26',
      raw: raw(['Content-Type: text/plain', '', 'Please see the attached responsive documents.']),
      candidates: KNOWN,
    });

    expect(result.action).toBe('FLAGGED_FOR_REVIEW');
    expect(result.responseOutcome).toBe('RECORDS_RECEIVED');
  });

  it('does not set an outcome on an award notice', () => {
    // An award notice is a trigger, not a reply — it says nothing about records.
    const result = decide(
      'solicitations@ttuhsc.edu',
      'Notification of Award: RFP 739-SL3722874',
      'Status: Awarded Award Date 1/29/2026',
    );

    expect(result.action).toBe('AWARD_RECORDED');
    expect(result.responseOutcome).toBeUndefined();
  });
});

describe('claimInboundMessage', () => {
  it('claims a message the first time', async () => {
    await expect(
      claimInboundMessage({
        messageId: '<abc@ttuhsc.edu>',
        orgId: 'org-1',
        action: 'AWARD_RECORDED',
        classification: 'AWARD_NOTICE',
      }),
    ).resolves.toBe(true);

    expect(mockCreateItem).toHaveBeenCalledWith(
      'FOIA_MAIL_SCAN',
      '<abc@ttuhsc.edu>',
      expect.objectContaining({ messageId: '<abc@ttuhsc.edu>', action: 'AWARD_RECORDED' }),
    );
  });

  it('reports a redelivery as already claimed rather than throwing', async () => {
    // SES retries on any Lambda error. An at-least-once delivery that re-recorded
    // an award or re-attached a document would corrupt the opportunity.
    mockCreateItem.mockRejectedValue(
      Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }),
    );

    await expect(
      claimInboundMessage({
        messageId: '<abc@ttuhsc.edu>',
        orgId: 'org-1',
        action: 'AWARD_RECORDED',
        classification: 'AWARD_NOTICE',
      }),
    ).resolves.toBe(false);
  });

  it('propagates a real failure instead of silently treating it as a duplicate', async () => {
    // Swallowing this would drop the message: SES would see success and never retry.
    mockCreateItem.mockRejectedValue(
      Object.assign(new Error('throughput'), { name: 'ProvisionedThroughputExceededException' }),
    );

    await expect(
      claimInboundMessage({
        messageId: '<abc@ttuhsc.edu>',
        orgId: 'org-1',
        action: 'IGNORED',
        classification: 'UNRELATED',
      }),
    ).rejects.toThrow('throughput');
  });

  it('sets a TTL so the ledger expires but the outcome does not', async () => {
    await claimInboundMessage({
      messageId: '<x@y>',
      orgId: 'org-1',
      action: 'IGNORED',
      classification: 'UNRELATED',
    });

    const item = mockCreateItem.mock.calls[0]?.[2] as { ttl: number };
    const days = (item.ttl - Math.floor(Date.now() / 1000)) / 86400;

    expect(days).toBeGreaterThan(85);
    expect(days).toBeLessThan(95);
  });
});

describe('buildMailScanSk', () => {
  it('keys on the RFC Message-ID, which is stable across redelivery', () => {
    // SES assigns a fresh receipt id per delivery, so keying on that would let the
    // same email through twice.
    expect(buildMailScanSk('  <abc@ttuhsc.edu>  ')).toBe('<abc@ttuhsc.edu>');
  });

  it.each([['', 'empty'], ['   ', 'whitespace'], [undefined, 'undefined']])(
    'refuses a %s id rather than writing an empty sort key',
    (value) => {
      /**
       * Found in production on the very first real message. DynamoDB rejects an
       * empty string as a key attribute, so an unparsed header surfaced as a raw
       * SDK ValidationException that named `sort_key` and nothing else. Failing
       * here names the actual problem.
       */
      expect(() => buildMailScanSk(value as unknown as string)).toThrow(/Message-ID/);
    },
  );
});

describe('awardDateFromMail', () => {
  it('prefers the award date the agency stated', () => {
    // Verbatim from the real TTUHSC notification block.
    expect(
      awardDateFromMail({
        receivedAt: '2026-08-12T10:00:00.000Z',
        bodyText: 'Status: Awarded  Award Date 1/29/2026',
      }),
    ).toEqual({ date: '2026-01-29', provenance: 'RECORDED_AWARD' });
  });

  it('accepts an ISO award date', () => {
    expect(
      awardDateFromMail({ receivedAt: '2026-08-12T10:00:00.000Z', bodyText: 'Award Date: 2026-01-29' }),
    ).toEqual({ date: '2026-01-29', provenance: 'RECORDED_AWARD' });
  });

  it('zero-pads a single-digit month and day', () => {
    expect(
      awardDateFromMail({ receivedAt: '2026-08-12T10:00:00.000Z', bodyText: 'Award Date 3/7/2026' }),
    ).toEqual({ date: '2026-03-07', provenance: 'RECORDED_AWARD' });
  });

  /**
   * The fallback must NOT claim RECORDED_AWARD.
   *
   * This test previously asserted RECORDED_AWARD, encoding the bug as expected
   * behaviour: the receipt date is when the notice reached our mailbox, not the date
   * the agency awarded, and RECORDED_AWARD would put that fabricated date into
   * "awarded on or about <date>" in a statutory filing.
   *
   * RECORDED_OUTCOME is the honest value — a real dated outcome exists, so it still
   * outranks a forecast for scheduling, but it describes what we actually hold.
   */
  it('falls back to the receipt date as a recorded OUTCOME, not a recorded award', () => {
    expect(
      awardDateFromMail({ receivedAt: '2026-08-12T10:00:00.000Z', bodyText: 'An award has been made.' }),
    ).toEqual({ date: '2026-08-12', provenance: 'RECORDED_OUTCOME' });
  });

  it("prefers the agency's own stated date over the receipt date", () => {
    // The whole point of the distinction: when the agency states a date, that date
    // is authoritative and the receipt date is irrelevant.
    expect(
      awardDateFromMail({
        receivedAt: '2026-08-12T10:00:00.000Z',
        bodyText: 'Award Date: 2026-01-29. Notice of award.',
      }),
    ).toEqual({ date: '2026-01-29', provenance: 'RECORDED_AWARD' });
  });
});

describe('toCorrelationCandidates', () => {
  const opp = (over: Record<string, unknown>) =>
    ({
      oppId: 'opp-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      solicitationNumber: 'RFP 739-SL3722874',
      title: 'Student Prospect',
      ...over,
    }) as unknown as OpportunityDBItem;

  it('maps an opportunity to a candidate', () => {
    expect(toCorrelationCandidates([opp({})])).toEqual([
      {
        oppId: 'opp-1',
        orgId: 'org-1',
        projectId: 'proj-1',
        solicitationNumber: 'RFP 739-SL3722874',
        title: 'Student Prospect',
      },
    ]);
  });

  it('drops records missing the keys every write is scoped by', () => {
    // In a multi-tenant table, acting on an unattributed record is the one mistake
    // worth being paranoid about.
    expect(toCorrelationCandidates([opp({ orgId: undefined })])).toEqual([]);
    expect(toCorrelationCandidates([opp({ projectId: undefined })])).toEqual([]);
    expect(toCorrelationCandidates([opp({ oppId: undefined, id: undefined })])).toEqual([]);
  });

  it('falls back to id when oppId is absent', () => {
    const [candidate] = toCorrelationCandidates([opp({ oppId: undefined, id: 'legacy-id' })]);

    expect(candidate?.oppId).toBe('legacy-id');
  });
});
