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
import { buildMailboxIdentity } from './foia-mail-identity';
import { parseRawMail } from './foia-mail-parse';
import type { OpportunityDBItem } from '@auto-rfp/core';

const raw = (lines: string[]): string => lines.join('\r\n');

/**
 * The live tenant: org 9c0a5757, the only one with `mailScrapeEnabled: true`, whose
 * `scrapeMailbox` is `foia@inbox.horustech.dev`. This is the identity the handler
 * builds from the resolved org's settings, so every case below decides exactly as
 * production does for that tenant.
 */
const LIVE = buildMailboxIdentity({ scrapeMailbox: 'foia@inbox.horustech.dev' });

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
    identity: LIVE,
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
      identity: LIVE,
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
      identity: LIVE,
    });

    expect(result.action).toBe('RESPONSE_ATTACHED');
    expect(result.attachmentNames).toEqual(['Evaluation Sheet.pdf']);
  });
});

describe('decideInboundMail — an award retraction never records an award', () => {
  /**
   * End to end, with the candidate the corpus is missing.
   *
   * The live archive contains exactly one retraction (`57k9ipvt8le8`, the BidNet 4142
   * message) and it flags for review only because no stored opportunity is numbered
   * 4142. Supplying that opportunity is what turns the replay's clean result into an
   * actual test — and it is precisely the gap that let the bug ship: the pre-existing
   * assertion never provided a correlating candidate, so it passed vacuously.
   */
  const RETRACTION_CANDIDATES = [
    ...KNOWN,
    { oppId: 'opp-4142', orgId: 'org-1', projectId: 'proj-1', solicitationNumber: '4142' },
    // Route 1 needs its own stored opportunity too. `decideInboundMail` gates on
    // `canActAutomatically(...) && single`, so WITHOUT a correlating candidate the
    // route-1 case below would return FLAGGED_FOR_REVIEW for want of a match and pass
    // whether or not the veto exists — mutation-checked, and the same vacuous shape
    // that let this bug ship past an assertion that looked like it covered it.
    {
      oppId: 'opp-w912',
      orgId: 'org-1',
      projectId: 'proj-1',
      solicitationNumber: 'W912DY-24-R-0001',
    },
  ];

  const retraction = (subject: string, body: string) =>
    decideInboundMail({
      from: 'noreply@bidnet.com',
      subject,
      raw: raw(['Content-Type: text/plain', '', body]),
      candidates: RETRACTION_CANDIDATES,
      identity: LIVE,
    });

  const REAL_4142_BODY = [
    'Michael Walker, The following award has been cancelled:',
    '   - Solicitation : 4142 - SolarWinds Renewal',
    '   - Award Type: Award',
    '   - Award Publication Date: 06/12/2026 12:42 PM EDT',
  ].join('\n');

  it('flags the real 4142 retraction instead of recording an award', () => {
    const result = retraction(
      'Fwd: "Award" for the 4142 solicitation has been cancelled',
      REAL_4142_BODY,
    );

    expect(result.action).toBe('FLAGGED_FOR_REVIEW');
    // The classification and the correlation are both KEPT — a reviewer needs to know
    // which opportunity the withdrawn posting was about. Only acting is refused.
    expect(result.classification.classification).toBe('AWARD_NOTICE');
    expect(result.classification.matchedOn).toContain('award-retracted');
    expect(result.classification.nonActionableReason).toBe('AWARD_RETRACTED');
    expect(result.match?.candidate.oppId).toBe('opp-4142');
  });

  it('flags a retraction that states an award date', () => {
    /**
     * SYNTHETIC body (see the classifier test of the same name): the real field is
     * "Award Publication Date", which `awardDateFromMail` does not parse. With a plain
     * "Award Date:" the retraction would hand `applyAwardNotice` a
     * `statedByAgency: true` date, and that value is written to
     * `agencyStatedAwardDate` — which `resolveAwardDate` ranks above every other
     * source. A withdrawn posting would outrank the real award date.
     */
    const result = retraction(
      'Fwd: "Award" for the 4142 solicitation has been cancelled',
      `${REAL_4142_BODY}\n   - Award Date: 06/12/2026`,
    );

    expect(result.action).toBe('FLAGGED_FOR_REVIEW');
    expect(result.classification.nonActionableReason).toBe('AWARD_RETRACTED');
  });

  it('flags a retraction carrying a federal-shaped number it can parse itself', () => {
    // Route 1: HIGH confidence off its own parsed identifier, which authorised the
    // action with no external identifier at all.
    const result = retraction(
      'Fwd: "Award" for the W912DY-24-R-0001 solicitation has been cancelled',
      REAL_4142_BODY.replace('4142 - SolarWinds', 'W912DY-24-R-0001 - SolarWinds'),
    );

    expect(result.action).toBe('FLAGGED_FOR_REVIEW');
    expect(result.classification.confidence).toBe('HIGH');
    // The correlation succeeded — this refuses on the veto, not for want of a match.
    expect(result.match?.candidate.oppId).toBe('opp-w912');
  });

  it('still records the legitimate award notice from the same mailbox', () => {
    /**
     * The negative pin, end to end. This is the shape of all six AWARD_RECORDED rows in
     * the live corpus, and it must survive with its award date intact.
     */
    const result = decideInboundMail({
      from: 'solicitations@ttuhsc.edu',
      subject: 'Notification of Award: RFP 739-SL3722874 - Student Prospect Digital Profile',
      raw: raw([
        'Content-Type: text/plain',
        '',
        'Solicitation ID: 739-SL3722874 Status: Awarded Award Date 1/29/2026',
      ]),
      candidates: RETRACTION_CANDIDATES,
      identity: LIVE,
    });

    expect(result.action).toBe('AWARD_RECORDED');
    expect(result.match?.candidate.oppId).toBe('opp-tx');
    expect(result.classification.nonActionableReason).toBeUndefined();
    expect(
      awardDateFromMail({ receivedAt: '2026-08-12T10:00:00.000Z', bodyText: 'Award Date 1/29/2026' }),
    ).toEqual({ date: '2026-01-29', provenance: 'RECORDED_AWARD', statedByAgency: true });
  });
});

describe('readResponseOutcome — what the agency actually did', () => {
  const outcome = (bodyText: string, attachmentNames: string[] = []) =>
    readResponseOutcome({
      classification: { classification: 'FOIA_RESPONSE', confidence: 'HIGH', matchedOn: [] },
      bodyText,
      attachmentNames,
      identity: LIVE,
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

  it("does not read our own letter's conditional denial clause as a denial", () => {
    /**
     * The `withheld` half of this was fixed once (see the test below); the `denied`
     * half was not. `/\b(?:your\s+)?request\s+(?:is|has\s+been)\s+denied\b/` makes
     * "your" OPTIONAL, so it fires on our own template's conditional
     * "If any portion of this request is denied ...".
     *
     * The comment above the denial block asserts "Every pattern requires the agency
     * as the actor" and that "the passive and conditional forms that appear in our
     * own letter cannot match". That guarantee is false for this pattern.
     *
     * Measured on the live corpus: the pattern fires on 8 of 110 real bodies, and in
     * every single case the match is our own boilerplate — never an agency denial
     * (files 848ko1tghclg, 9sqem1ljcnq4, ce9mrkq2imo2, etug8g8m9cnd, frlbqtfbnkrd,
     * lanfoc9kkmg5, 615sciteu2kj, p1a3vs5829u7).
     *
     * Consequence: as soon as one of those forwarded replies is classified
     * FOIA_RESPONSE (see the misclassification defects in foia-mail-classify.test.ts),
     * applyResponse writes responseOutcome DENIED for a cooperative agency — poisoning
     * the comparison dashboard and inviting an appeal against an agency that refused
     * nothing.
     */
    const ourClause =
      'Please provide these records in electronic format if available. If any portion ' +
      'of this request is denied or withheld, please cite the specific RCW 42.56 ' +
      'exemption relied upon for each withheld record, as required under the Act.';

    expect(outcome(ourClause)).toBe('ACKNOWLEDGED');
  });

  /**
   * The conditional guard is scoped PER SENTENCE, not to the whole body.
   *
   * Applying it to the body made it a global veto, and appeal-rights boilerplate
   * carries a conditional "denied" in nearly every real denial letter — so a genuine
   * denial returned ACKNOWLEDGED because a LATER, unrelated sentence was hypothetical.
   * These cases pin the scoping: the suite passed with the whole-body test in place,
   * which is why they are worth having.
   */
  it.each([
    [
      'appeal-rights boilerplate after the denial',
      'Your request is denied in part under Exemption 6. If a request is denied in whole or in part, the requester may appeal within 90 days.',
    ],
    [
      'conditional appeal wording after a withholding',
      'We are withholding two documents as exempt. Should a request be denied, you may appeal to the custodian.',
    ],
    [
      'exemption stated as a fragment on its own line',
      'Re: your public records request\nRecords are exempt from disclosure\nRegards, City Clerk',
    ],
  ])('reads a denial that also carries %s', (_label, body) => {
    expect(outcome(body)).toBe('DENIED');
  });

  /**
   * The conditional guard has to be tested on a sentence that ALSO matches a denial
   * pattern, or it is untested rather than merely unused.
   *
   * Our own template no longer matches any denial pattern (the possessive became
   * mandatory), so the existing "our own letter" case passes with the guard deleted
   * entirely — mutation-checked. These are agency sentences that DO match a pattern
   * while being plainly hypothetical, which is the only shape the guard exists for.
   */
  it.each([
    ['a conditional denial in appeal instructions', 'If your request is denied you may appeal within 30 days.'],
    ['a conditional withholding', 'Unless we are withholding records, you should receive them shortly.'],
    ['a conditional exemption', 'In the event records are exempt from disclosure we will identify them.'],
  ])('does not read %s as a denial', (_label, body) => {
    expect(outcome(body)).toBe('ACKNOWLEDGED');
  });

  it("still ignores our own letter when it spans several sentences", () => {
    // Per-sentence scoping must not reopen the false positive it replaced: every
    // clause here is ours, and the only "denied" is hypothetical.
    expect(
      outcome(
        'Pursuant to the CPRA I request the notice of award. If any portion of this ' +
          'request is denied, cite the exemption relied upon. Please respond within 10 days.',
      ),
    ).toBe('ACKNOWLEDGED');
  });

  it('still reads a real agency denial', () => {
    // The guard above must not blunt genuine denials. An agency writes the
    // possessive and states the act in the present tense.
    expect(outcome('Your request is denied in its entirety under Exemption 5.')).toBe('DENIED');
    expect(outcome('We are withholding the remaining records under Government Code 6254.')).toBe(
      'DENIED',
    );
  });

  it('ignores a denial clause quoted from our letter beneath an agency reply', () => {
    /**
     * The same clause as above, in the shape it actually arrives: below the agency's
     * own two lines and a Gmail attribution. This is what the 8 real corpus bodies
     * look like, and it is why the fix is `stripQuotedReply` rather than another
     * pattern tweak — the text is genuinely there, it is just not the agency's.
     */
    const agencyReplyQuotingUs = [
      'Good afternoon,',
      '',
      'Your request has been received and assigned to our records officer.',
      '',
      'On Mon, Aug 17, 2026 at 10:33 AM Brennen Stones <brennen@horustech.dev> wrote:',
      '> If any portion of this request is denied or withheld, please cite the',
      '> specific RCW 42.56 exemption relied upon for each withheld record.',
    ].join('\n');

    expect(outcome(agencyReplyQuotingUs)).toBe('ACKNOWLEDGED');
  });

  it('ignores a PRODUCTION phrase quoted from our own follow-up', () => {
    /**
     * The case that actually pins the `stripQuotedReply` call in `readResponseOutcome`.
     *
     * The test above does not: the conditional-denial clause it quotes is already
     * defeated by `isConditionalSentence`, so deleting the strip entirely leaves it
     * green — measured, along with the rest of the suite (693 passing with the call
     * removed). The strip needs a phrase that no other guard catches.
     *
     * A production phrase in OUR OWN words does that. Here we chased an agency that
     * claimed to enclose records and did not; the agency's reply says only that the
     * request is still open, but our quoted line contains "the records are enclosed".
     * Stripped, this is correctly ACKNOWLEDGED. Unstripped it reads RECORDS_RECEIVED —
     * booking a production that never happened, off our own complaint that it never
     * happened.
     */
    const ourProductionPhraseQuotedBack = [
      'Good afternoon,',
      '',
      'Your follow-up is with our records officer and remains open.',
      '',
      'On Mon, Aug 17, 2026 at 10:33 AM Brennen Stones <brennen@horustech.dev> wrote:',
      '> Your earlier message stated the records are enclosed, but nothing was attached.',
      '> Please resend.',
    ].join('\n');

    expect(outcome(ourProductionPhraseQuotedBack)).toBe('ACKNOWLEDGED');
  });

  it('reads "we do not have any documents" as no records located', () => {
    /**
     * Real message 615sciteu2kj — SC Division of Procurement Services, 2026-07-09,
     * on Solicitation 5400028096.
     *
     * The agency states plainly that it holds nothing, then closes the request. But
     * the `no-records-located` pattern requires "no records ... was/were
     * located|found|identified", and this agency wrote "We do not have any ...
     * documents" — a form the regex cannot reach. So the check falls through to the
     * attachment branch, where `attachmentNames` is `['Outlook-em5gwklr']`: an inline
     * Outlook image artifact, not a produced record. `attachmentNames.length > 0`
     * short-circuits to RECORDS_RECEIVED.
     *
     * Consequence: the opportunity records responseOutcome=RECORDS_RECEIVED for a
     * request that returned nothing. That is the one fact observable nowhere else —
     * it means we never bid, or the agency cancelled before award — and it is
     * inverted. A reviewer sees "records received" and stops looking.
     *
     * Two defects, either of which alone would cause this: the phrasing gap, and
     * treating any MIME filename as evidence of produced records.
     */
    const scReply = [
      'Good afternoon,',
      '',
      'Our office has received your request regarding Solicitation #5400028096.',
      'This solicitation was cancelled after opening but before award with the',
      'intent to resolicit. We do not have any evaluation/scoring or debriefing',
      'documents.',
      '',
      'This fulfills your request.',
    ].join('\n');

    expect(outcome(scReply, ['Outlook-em5gwklr'])).toBe('NO_RECORDS_LOCATED');
  });

  it('does not treat signature-block images as produced records (end to end)', () => {
    /**
     * The filtering happens in `parseRawMail`, so this exercises the real MIME shape
     * rather than calling `readResponseOutcome` with a hand-made name list.
     *
     * Headers copied from real messages: every decorative image in the corpus is
     * `Content-Disposition: inline` with a `Content-ID` (Outlook `image001.png`,
     * `Outlook-em5gwklr`, Gmail `image.png`, GSA `Cloud 4.png`), while the three
     * genuinely released records in `4soe9nenigvt` are `attachment`.
     *
     * The dangerous case is the one asserted here: an agency denying a request from
     * Outlook had its denial MASKED, because the attachment count was checked before
     * every DENIED pattern and a letterhead logo satisfied it.
     */
    const rawWithSignatureImage = [
      'From: Records <records@city.gov>',
      'Subject: RE: Public Records Request',
      'Content-Type: multipart/related; boundary="BOUND1"',
      '',
      '--BOUND1',
      'Content-Type: text/plain',
      '',
      'Your request is denied in its entirety under Government Code 6254.',
      '--BOUND1',
      'Content-Type: image/png; name="image001.png"',
      'Content-Disposition: inline; filename="image001.png"; size=1527',
      'Content-ID: <image001.png@01DD2C08.D837A9B0>',
      'Content-Transfer-Encoding: base64',
      '',
      'iVBORw0KGgo=',
      '--BOUND1--',
      '',
    ].join('\r\n');

    const { text, attachmentNames, inlineImageNames } = parseRawMail(rawWithSignatureImage);

    expect(attachmentNames).toEqual([]);
    expect(inlineImageNames).toEqual(['image001.png']);
    expect(
      readResponseOutcome({
        classification: { classification: 'FOIA_RESPONSE', confidence: 'HIGH', matchedOn: [] },
        bodyText: text,
        attachmentNames,
        identity: LIVE,
      }),
      ).toBe('DENIED');
  });

  it('still counts a genuinely attached record', () => {
    // The other side of the same distinction: `attachment` disposition must survive.
    const rawWithRealAttachment = [
      'From: Records <records@city.gov>',
      'Subject: RE: Public Records Request',
      'Content-Type: multipart/mixed; boundary="B2"',
      '',
      '--B2',
      'Content-Type: text/plain',
      '',
      'Please see the enclosed.',
      '--B2',
      'Content-Type: application/pdf; name="Notice of Selection.pdf"',
      'Content-Disposition: attachment; filename="Notice of Selection.pdf"',
      '',
      'JVBERi0=',
      '--B2--',
      '',
    ].join('\r\n');

    const { text, attachmentNames } = parseRawMail(rawWithRealAttachment);

    expect(attachmentNames).toEqual(['Notice of Selection.pdf']);
    expect(
      readResponseOutcome({
        classification: { classification: 'FOIA_RESPONSE', confidence: 'HIGH', matchedOn: [] },
        bodyText: text,
        attachmentNames,
        identity: LIVE,
      }),
      ).toBe('RECORDS_RECEIVED');
  });

  it('trusts the attachment list it is given', () => {
    /**
     * Inline filtering belongs to `parseRawMail`, which is where MIME headers are
     * available — see the end-to-end test above. Once a name reaches
     * `readResponseOutcome` it has already been judged a real attachment, so this
     * documents the remaining contract: a non-empty list means records were produced.
     *
     * The original version of this test asserted the opposite (that `image001.png` in
     * the list must not count), which pushed extension-sniffing into the wrong layer —
     * a released record can legitimately be a `.png` scan. Measured on the live corpus,
     * the disposition check fixed all 12 affected messages, including three live
     * FOIA_RESPONSE rows (615sciteu2kj, p1a3vs5829u7, vrl3d7c7m5q2).
     *
     * The dangerous case is this one: an agency that denies a request from Outlook has
     * its denial MASKED, because the image short-circuits the DENIED branch. The
     * opportunity is recorded as satisfied, the operator stops chasing it, and the
     * appeal window on a real denial lapses unnoticed.
     */
    expect(
      outcome('Please see the enclosed.', ['Notice of Selection.pdf']),
    ).toBe('RECORDS_RECEIVED');
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
      identity: LIVE,
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
      identity: LIVE,
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
    ).toEqual({ date: '2026-01-29', provenance: 'RECORDED_AWARD', statedByAgency: true });
  });

  it('accepts an ISO award date', () => {
    expect(
      awardDateFromMail({ receivedAt: '2026-08-12T10:00:00.000Z', bodyText: 'Award Date: 2026-01-29' }),
    ).toEqual({ date: '2026-01-29', provenance: 'RECORDED_AWARD', statedByAgency: true });
  });

  it('zero-pads a single-digit month and day', () => {
    expect(
      awardDateFromMail({ receivedAt: '2026-08-12T10:00:00.000Z', bodyText: 'Award Date 3/7/2026' }),
    ).toEqual({ date: '2026-03-07', provenance: 'RECORDED_AWARD', statedByAgency: true });
  });

  it('accepts a real leap day', () => {
    // Guards the range check against being written as a naive "day <= 28" test.
    expect(
      awardDateFromMail({ receivedAt: '2026-08-12T10:00:00.000Z', bodyText: 'Award Date: 2024-02-29' }),
    ).toEqual({ date: '2024-02-29', provenance: 'RECORDED_AWARD', statedByAgency: true });
  });

  /**
   * A date-SHAPED string that names no real day must not be trusted.
   *
   * The regex proves shape, not existence, so `13/45/2026` formatted cleanly to
   * `2026-13-45` and returned `statedByAgency: true` — the gate that writes straight
   * to `outcomeDate` and authorises an unattended send. `Date.UTC` then rolled it
   * over silently (month 13 day 45 → 2027-02-14), so the letter would assert
   * "awarded on or about" a day the agency never stated and that never happened.
   *
   * Falling back to the receipt date is the correct failure direction: that branch
   * returns the weaker RECORDED_OUTCOME and `statedByAgency: false`, so the request
   * is held for a human instead of sent asserting a fabricated date.
   */
  it.each([
    ['an impossible month and day', 'Award Date: 13/45/2026'],
    ['a day that overflows the month', 'Award Date: 02/30/2026'],
    ['an impossible ISO date', 'Award Date: 2026-13-45'],
    ['Feb 29 in a non-leap year', 'Award Date: 2026-02-29'],
  ])('ignores %s and falls back to the receipt date', (_label, bodyText) => {
    expect(
      awardDateFromMail({ receivedAt: '2026-08-12T10:00:00.000Z', bodyText }),
    ).toEqual({ date: '2026-08-12', provenance: 'RECORDED_OUTCOME', statedByAgency: false });
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
    ).toEqual({ date: '2026-08-12', provenance: 'RECORDED_OUTCOME', statedByAgency: false });
  });

  it("prefers the agency's own stated date over the receipt date", () => {
    // The whole point of the distinction: when the agency states a date, that date
    // is authoritative and the receipt date is irrelevant.
    expect(
      awardDateFromMail({
        receivedAt: '2026-08-12T10:00:00.000Z',
        bodyText: 'Award Date: 2026-01-29. Notice of award.',
      }),
    ).toEqual({ date: '2026-01-29', provenance: 'RECORDED_AWARD', statedByAgency: true });
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

describe('decideInboundMail — the identity comes from the TENANT, not a hardcoded domain', () => {
  /**
   * The fix, end to end, at the level where the decision is actually taken.
   *
   * `stripQuotedReply` took an injectable `isOurs` predicate whose default was a
   * hardcoded `/horustech\.dev|@horustech\b/`, and no production caller ever passed
   * one — so for any org whose monitored mailbox is on another domain no cut point was
   * found and the whole authorship fix was inert. The identity is now threaded from the
   * resolved org's `scrapeMailbox` and required at every seam.
   */
  const ACME = buildMailboxIdentity({ scrapeMailbox: 'foia@acme.com' });

  const AGENCY_CANCELLATION_BODY = [
    'Unfortunately, C25910004 was cancelled and not awarded via IFB.',
    '',
    'From: Brennen Stones <brennen@acme.com>',
    '',
    'Pursuant to the California Public Records Act, the undersigned requests copies',
    'of the following public records, including the notice of award and the awarded',
    'contract value.',
  ].join('\n');

  const decideAs = (identity: Parameters<typeof decideInboundMail>[0]['identity']) =>
    decideInboundMail({
      from: 'Channel Coast District Contract Bids <ccdbid@parks.ca.gov>',
      subject: 'RE: California Public Records Act Request — IFB C25910004',
      raw: raw(['Content-Type: text/plain', '', AGENCY_CANCELLATION_BODY]),
      candidates: KNOWN,
      identity,
    });

  it('suppresses on the agency’s stated cancellation for a tenant on its own domain', () => {
    const result = decideAs(ACME);

    expect(result.action).toBe('SUPPRESSED');
    expect(result.classification.classification).toBe('SOLICITATION_CANCELLED');
    expect(result.match?.candidate.oppId).toBe('opp-ca');
  });

  it('is the wrong answer the hardcoded default produced for that tenant', () => {
    // The same message read with an identity that does not own `acme.com`: the quoted
    // letter re-enters the authorship haystack and the agency's reply books as our own
    // outgoing request, so the cancellation never suppresses anything.
    const result = decideAs(LIVE);

    expect(result.action).toBe('OWN_REQUEST_LOGGED');
    expect(result.classification.classification).toBe('OUR_OWN_REQUEST');
  });

  it('reads the response outcome from the agency’s words, not our quoted boilerplate', () => {
    /**
     * The `readResponseOutcome` half of the same threading. Our own letter's
     * conditional "If any portion of this request is denied…" is what produced 8 false
     * DENIED verdicts on the live corpus, and the strip is what removes the class. With
     * no identity reaching it, a non-vendor tenant kept every one of them.
     */
    const result = decideInboundMail({
      from: 'records@city.gov',
      subject: 'Response: Public Records Act Request 26-528',
      raw: raw([
        'Content-Type: text/plain',
        '',
        'In response to your request, no responsive records were located.',
        '',
        'From: Brennen Stones <brennen@acme.com>',
        '',
        'If any portion of this request is denied, please identify the specific',
        'exemption claimed for each withheld portion.',
      ]),
      candidates: KNOWN,
      identity: ACME,
    });

    expect(result.responseOutcome).toBe('NO_RECORDS_LOCATED');
  });

  it('still records the legitimate award for the live tenant (NEGATIVE pin)', () => {
    /**
     * The behaviour-neutrality pin. This is the shape of all six AWARD_RECORDED rows in
     * the 335-message corpus (the same 'Notification of Award: RFP 739-SL3732580'
     * delivery, opp 06b56638, {2026-01-29, RECORDED_AWARD, statedByAgency: true}), and
     * the replay confirms 0 of 335 decisions move. Pinned here so a future change to the
     * identity plumbing cannot quietly take the award path with it.
     */
    const result = decideInboundMail({
      from: 'solicitations@ttuhsc.edu',
      subject: 'Notification of Award: RFP 739-SL3722874 - Student Prospect Digital Profile',
      raw: raw([
        'Content-Type: text/plain',
        '',
        'Solicitation ID: 739-SL3722874 Status: Awarded Award Date 1/29/2026',
      ]),
      candidates: KNOWN,
      identity: LIVE,
    });

    expect(result.action).toBe('AWARD_RECORDED');
    expect(result.match?.candidate.oppId).toBe('opp-tx');
    expect(
      awardDateFromMail({ receivedAt: '2026-08-12T10:00:00.000Z', bodyText: 'Award Date 1/29/2026' }),
    ).toEqual({ date: '2026-01-29', provenance: 'RECORDED_AWARD', statedByAgency: true });
  });

  it('an org with no configured mailbox behaves exactly as today', () => {
    /**
     * `getFoiaSettings` never throws — with no stored row it returns
     * `buildDefaultFoiaSettings`, whose `scrapeMailbox` is nullish. That degrades to the
     * platform's own sending host, which reproduces the deleted regex's behaviour on
     * this corpus exactly. Do not remove that fallback.
     */
    const unconfigured = buildMailboxIdentity({});

    const result = decideInboundMail({
      from: 'proposals@horustech.dev',
      subject: 'RE: California Public Records Act Request — IFB C25910004',
      raw: raw([
        'Content-Type: text/plain',
        '',
        'Unfortunately, C25910004 was cancelled and not awarded via IFB.',
        '',
        'From: Brennen Stones <brennen@horustech.dev>',
        '',
        'Pursuant to the California Public Records Act, the undersigned requests records.',
      ]),
      candidates: KNOWN,
      identity: unconfigured,
    });

    expect(result.action).toBe('SUPPRESSED');
    expect(result.classification.classification).toBe('SOLICITATION_CANCELLED');
  });
});
