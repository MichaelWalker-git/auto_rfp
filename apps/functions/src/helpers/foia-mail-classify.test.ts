import {
  canActAutomatically,
  classifyMailDeterministic,
  hasGovernmentAuthorInThread,
  isGovernmentSender,
  isKnownSolicitationSender,
} from './foia-mail-classify';

const mail = (over: Partial<Parameters<typeof classifyMailDeterministic>[0]> = {}) => ({
  from: 'noreply@sam.gov',
  subject: 'Notice',
  body: '',
  ...over,
});

describe('sender recognition', () => {
  it('recognises the structured solicitation sources', () => {
    for (const from of [
      'noreply@sam.gov',
      'alerts@highergov.com',
      'no-reply@dibbs.bsm.dla.mil',
      'notices@fbo.gov',
    ]) {
      expect(isKnownSolicitationSender(from)).toBe(true);
    }
  });

  it('recognises a government sender generally', () => {
    expect(isGovernmentSender('jane.roe@us.army.mil')).toBe(true);
    expect(isGovernmentSender('foia@state.gov')).toBe(true);
    expect(isGovernmentSender('Jane Roe <jane@gsa.gov>')).toBe(true);
  });

  it('does not treat a commercial sender as governmental', () => {
    expect(isGovernmentSender('sales@vendor.com')).toBe(false);
    expect(isKnownSolicitationSender('sales@vendor.com')).toBe(false);
    // A lookalike domain must not pass.
    expect(isGovernmentSender('phish@notreally-gov.com')).toBe(false);
  });

  it('recovers a public-body author the Google Group relay hid', () => {
    /**
     * The monitored mailbox is a Google Group, and the relay rewrites `From:` to
     * `proposals@horustech.dev` — so `isGovernmentSender` reports false for genuine
     * agency replies (real messages `848ko1tghclg`, `lanfoc9kkmg5`, `6bh3ncdo9e10`,
     * `04tvnbq4teg4`). The real author survives in the forwarded header block.
     */
    const forwarded = [
      '---------- Forwarded message ---------',
      'From: Channel Coast District Contract Bids <ccdbid@parks.ca.gov>',
      'Subject: Re: California Public Records Act Request',
      '',
      'Unfortunately, C25910004 was cancelled and not awarded via IFB.',
    ].join('\n');

    expect(hasGovernmentAuthorInThread(forwarded)).toBe(true);
  });

  it('does not read the agency we wrote TO as the author', () => {
    /**
     * The stop condition that keeps this from inverting. In our own outbound letter
     * the first `From:` is us; any `.gov` below it is a recipient, not an author.
     * Without the stop, every request addressed to a `.gov` would look
     * agency-authored — verified against all 11 genuine outbound letters in the
     * corpus, which this correctly leaves alone.
     */
    const ourLetter = [
      '---------- Forwarded message ---------',
      'From: Brennen Stones <brennen@horustech.dev>',
      'To: records@ci.example.gov',
      '',
      'Pursuant to the California Public Records Act, I am requesting copies of...',
    ].join('\n');

    expect(hasGovernmentAuthorInThread(ourLetter)).toBe(false);
  });
});

describe('award notices', () => {
  it('classifies a SAM.gov award notice with a notice id', () => {
    const r = classifyMailDeterministic(
      mail({
        subject: 'Award Notice: Widget Support Services',
        body: 'An award has been made. Notice ID: 4f2b8c1d9e7a6b5c4d3e2f1a0b9c8d7e',
      }),
    );

    expect(r.classification).toBe('AWARD_NOTICE');
    expect(r.confidence).toBe('HIGH');
    expect(r.noticeId).toBe('4f2b8c1d9e7a6b5c4d3e2f1a0b9c8d7e');
    expect(canActAutomatically(r)).toBe(true);
  });

  it('classifies an unsuccessful-offeror letter as the same trigger', () => {
    // The company has never won an award, so this is the notice they actually
    // receive — the loss side of the same event.
    const r = classifyMailDeterministic(
      mail({
        from: 'contracting.officer@us.army.mil',
        subject: 'Unsuccessful Offeror Notification',
        body:
          'This is to notify you that your proposal for Solicitation W912DY-24-R-0001 ' +
          'was not selected for award.',
      }),
    );

    expect(r.classification).toBe('AWARD_NOTICE');
    expect(r.confidence).toBe('HIGH');
    expect(r.solicitationNumber).toBe('W912DY-24-R-0001');
    expect(r.matchedOn).toContain('unsuccessful-offeror');
    expect(canActAutomatically(r)).toBe(true);
  });

  it('recognises "was not successful" phrasing', () => {
    const r = classifyMailDeterministic(
      mail({
        subject: 'Solicitation SP4701-25-Q-0123 result',
        body: 'Your quote was not successful on this requirement.',
      }),
    );

    expect(r.classification).toBe('AWARD_NOTICE');
    expect(r.solicitationNumber).toBe('SP4701-25-Q-0123');
  });

  it('will not act on an award phrase with no identifier', () => {
    const r = classifyMailDeterministic(
      mail({ subject: 'Contract award posted', body: 'An award notice was published today.' }),
    );

    expect(r.classification).toBe('AWARD_NOTICE');
    // Knowing *an* award happened is useless without knowing which solicitation.
    expect(r.confidence).toBe('MEDIUM');
    expect(canActAutomatically(r)).toBe(false);
  });
});

describe('cancellations', () => {
  it('classifies a cancelled solicitation with an identifier', () => {
    const r = classifyMailDeterministic(
      mail({
        subject: 'Cancellation of Solicitation W912DY-24-R-0001',
        body: 'The solicitation has been cancelled and no award will be made.',
      }),
    );

    expect(r.classification).toBe('SOLICITATION_CANCELLED');
    expect(r.confidence).toBe('HIGH');
    expect(canActAutomatically(r)).toBe(true);
  });

  it('accepts the British spelling', () => {
    const r = classifyMailDeterministic(
      mail({ subject: 'RFP cancelled', body: 'Solicitation SP4701-25-Q-0123 has been cancelled.' }),
    );

    expect(r.classification).toBe('SOLICITATION_CANCELLED');
  });

  it('recognises an agency stating a solicitation "was cancelled" in a reply', () => {
    /**
     * Real messages i3o2h82ak04i and pm4tl45k4m77 — CA State Parks, Channel Coast
     * District (ccdbid@parks.ca.gov), 2026-07-21, replying about IFB C25910004.
     * Two separate deliveries, two separate ledger rows, both misdecided.
     *
     * Three independent failures stack up:
     *  1. No CANCELLED_PATTERNS entry matches "was cancelled". `has-been-cancelled`
     *     needs "has been"; `solicitation-cancelled` needs the solicitation keyword
     *     BEFORE the verb, but here IFB trails it ("cancelled and not awarded via IFB").
     *  2. Even with a match, REQUEST_CONTEXT_MARKERS ctx2 and ctx3 fire on OUR OWN
     *     quoted letter ("the notice of award and the awarded contract value",
     *     "All individual evaluator scoresheets"), which sets cancelledHits = [].
     *  3. The outbound gate then claims the message on `pursuant-to-act`, also
     *     matched against the quoted original — so it books as our own outgoing mail.
     *
     * Consequence: the agency has stated on the record that no award exists. Nothing
     * suppresses the automation and no human is told, so the Level 2 timer will
     * transmit a statutory demand to CA Parks for evaluator scoresheets and "the
     * awarded contract value" of a contract that was never awarded — in the
     * customer's name. This is exactly what SOLICITATION_CANCELLED exists to prevent.
     *
     * At minimum this must not classify as OUR_OWN_REQUEST; a cancellation stated by
     * an agency should suppress, and a reply should at least reach a human.
     */
    const r = classifyMailDeterministic({
      from: 'Channel Coast District Contract Bids <ccdbid@parks.ca.gov>',
      subject:
        'Re: California Public Records Act Request – IFB C25910004, Lifeguard Dispatch Software Services, Channel Coast District',
      body: [
        'Hello,',
        '',
        'Unfortunately, C25910004 was cancelled and not awarded via IFB.',
        '',
        'Please let me know if you have any additional questions.',
        '',
        'Thank you,',
        'Patrick Gallegos',
        '',
        'On Mon, Jul 20, 2026 Brennen Stones <brennen@horustech.dev> wrote:',
        '> Pursuant to the California Public Records Act, I am requesting copies of the',
        '> following public records related to IFB C25910004:',
        '> 4. The notice of award and the awarded contract value for IFB C25910004;',
        '> 5. All individual evaluator scoresheets prepared for this solicitation;',
      ].join('\n'),
    });

    expect(r.classification).not.toBe('OUR_OWN_REQUEST');
  });

  it('does not treat a retracted AWARD posting as a cancelled solicitation', () => {
    /**
     * Real message 57k9ipvt8le8 (BidNet, forwarded 2026-06-25).
     *
     * BidNet cancels the *award publication* — the solicitation is alive and a new
     * award will follow. `has-been-cancelled` matches "The following award has been
     * cancelled", and `solicitation-cancelled` matches across the subject because
     * `\b(solicitation|...)\b[^.]{0,40}\bcancel(l)?ed\b` spans "solicitation has
     * been cancelled" with no sentence boundary between them.
     *
     * Consequence is the inverse of the intended safety property: SUPPRESSED
     * withdraws the FOIA automation precisely when an award IS coming. It only
     * escaped here because we hold no opportunity numbered 4142 — with the
     * opportunity present this correlates and suppresses unattended (verified by
     * replaying this body against a candidate list containing 4142).
     *
     * An award retraction should read as AWARD_NOTICE-adjacent or flag for review;
     * it must never suppress.
     */
    const r = classifyMailDeterministic({
      from: 'noreply@bidnet.com',
      subject: 'Fwd: "Award" for the 4142 solicitation has been cancelled',
      body: [
        'Michael Walker, The following award has been cancelled:',
        '   - Solicitation : 4142 - SolarWinds Renewal',
        '   - Award Type: Award',
        '   - Award Publication Date: 06/12/2026 12:42 PM EDT',
      ].join('\n'),
    });

    expect(r.classification).not.toBe('SOLICITATION_CANCELLED');
  });

  it('takes precedence over an award phrase in the same message', () => {
    // A cancellation notice often references the award process it terminates.
    // Suppressing is safer than filing a FOIA for an award that never happened.
    const r = classifyMailDeterministic(
      mail({
        subject: 'Notice of Cancellation',
        body:
          'The award process for Solicitation W912DY-24-R-0001 is terminated; ' +
          'the solicitation has been cancelled.',
      }),
    );

    expect(r.classification).toBe('SOLICITATION_CANCELLED');
  });
});

describe('FOIA responses', () => {
  it('classifies an agency acknowledgement and captures the tracking number', () => {
    const r = classifyMailDeterministic(
      mail({
        from: 'foia@army.mil',
        subject: 'Acknowledgement of your FOIA request',
        body: 'We have received your FOIA request. FOIA Request Number: 2026-ARMY-01234',
      }),
    );

    expect(r.classification).toBe('FOIA_RESPONSE');
    expect(r.trackingNumber).toBe('2026-ARMY-01234');
    expect(r.confidence).toBe('HIGH');
    // A reply is never a trigger — it must not move an opportunity's schedule.
    expect(canActAutomatically(r)).toBe(false);
  });

  it('wins over an award phrase, since a reply may quote the award', () => {
    const r = classifyMailDeterministic(
      mail({
        from: 'foia@navy.mil',
        subject: 'Your FOIA request',
        body:
          'Regarding your FOIA request about the contract award for W912DY-24-R-0001, ' +
          'case number NAVY-2026-004567.',
      }),
    );

    expect(r.classification).toBe('FOIA_RESPONSE');
  });

  it('classifies a state public-records acknowledgement', () => {
    const r = classifyMailDeterministic(
      mail({
        from: 'records@dgs.ca.gov',
        subject: 'Public records request received',
        body: 'Your public records request was received on 1 March.',
      }),
    );

    expect(r.classification).toBe('FOIA_RESPONSE');
  });
});

describe('identifier extraction', () => {
  it('pulls a 32-hex SAM notice id', () => {
    const r = classifyMailDeterministic(
      mail({ subject: 'Award Notice', body: 'ID 0123456789abcdef0123456789abcdef' }),
    );

    expect(r.noticeId).toBe('0123456789abcdef0123456789abcdef');
  });

  it('does not mistake a short hex string for a notice id', () => {
    const r = classifyMailDeterministic(
      mail({ subject: 'Award Notice', body: 'colour #a1b2c3 and ref deadbeef' }),
    );

    expect(r.noticeId).toBeUndefined();
  });

  it('does not treat an arbitrary hyphenated token as a solicitation number', () => {
    const r = classifyMailDeterministic(
      mail({ subject: 'Award Notice', body: 'Order ABC-1-X-2 and ticket HELP-42.' }),
    );

    // A loose pattern here would correlate mail to the wrong opportunity.
    expect(r.solicitationNumber).toBeUndefined();
    expect(canActAutomatically(r)).toBe(false);
  });

  it('is repeatable — global regex state does not leak between calls', () => {
    const m = mail({
      subject: 'Award Notice W912DY-24-R-0001',
      body: 'Solicitation W912DY-24-R-0001 awarded.',
    });

    const first = classifyMailDeterministic(m);
    const second = classifyMailDeterministic(m);
    const third = classifyMailDeterministic(m);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});

describe('real subject lines from the monitored mailbox', () => {
  // Verbatim from the Google Group. Every one of these classified as UNRELATED
  // before the records-statute patterns existed, because the original rules
  // assumed federal "FOIA" vocabulary and this pipeline is mostly state work.
  const real = (subject: string, body = '') =>
    classifyMailDeterministic({ from: 'someone@agency.gov', subject, body });

  it.each([
    'Freedom of Information Act Request – Solicitation No. 5400028096, DNR Website and Hosting',
    'California Public Records Act Request – IFB C25910004, Lifeguard Dispatch Software Services',
    'Texas Public Information Act Request — RFP 739-SL3722874, Student Prospect Digital Profile Solution',
  ])('recognises our own outbound request: %s', (subject) => {
    const r = real(`Fwd: ${subject}`);

    expect(r.classification).toBe('OUR_OWN_REQUEST');
    // Our own letter names a statute and describes an award — never a trigger.
    expect(canActAutomatically(r)).toBe(false);
  });

  it('classifies a terse agency reply and pulls the tracking number', () => {
    const r = real('Fwd: PRA 26-528 - Response - 07.17.26');

    expect(r.classification).toBe('FOIA_RESPONSE');
    expect(r.trackingNumber).toBe('26-528');
    expect(r.confidence).toBe('HIGH');
  });

  it('classifies a "Response:" subject as a reply', () => {
    const r = real('Fwd: Response: RFP No. 26-16, AI-Powered Student Attendance Platform (07.09.26)');

    expect(r.classification).toBe('FOIA_RESPONSE');
  });

  it('classifies a portal closure notice and pulls its request number', () => {
    const r = real('Fwd: Your City of Piedmont, CA public records request #26-112 has been closed.');

    expect(r.classification).toBe('FOIA_RESPONSE');
    expect(r.trackingNumber).toBe('26-112');
  });

  it('treats an agency reply quoting our request as a reply, not as ours', () => {
    // Agencies quote the original in full, so both marker sets fire. The reply
    // marker must win, or a delivered response would look like an unsent request.
    const r = real(
      'RE: Texas Public Information Act Request — RFP 739-SL3722874',
      'Texas Tech University is in receipt of your open records request below. ' +
        'Pursuant to said request, please see the attached responsive documents.',
    );

    expect(r.classification).toBe('FOIA_RESPONSE');
  });

  it('recognises an agency acknowledgement that names the statute by acronym only', () => {
    /**
     * Real message cvfodjo47ucp — LA Fire & Police Pensions (LAFPP) acknowledging a
     * CPRA request and issuing tracking number CPRA-0319.
     *
     * It classified UNRELATED with `matchedOn: []` — not one pattern fired:
     *
     *  - `we-received-your-request` requires `request|records` IMMEDIATELY after
     *    "your"; the real subject interposes the statute: "your CPRA / FOIA request".
     *  - `records-request-received` needs "received" AFTER the phrase; here the
     *    agency leads with it ("We have received your ... request").
     *  - `records-act-request` and `records-act` need the statute spelled out;
     *    LAFPP writes the acronym and pairs "Act" with "inquiry", not "request".
     *  - `acronym-tracking` and the tracking-number patterns want DD-DDDD after the
     *    acronym; "CPRA-0319" is acronym + one 4-digit group.
     *
     * Consequence: an agency's formal acknowledgement is IGNORED — no state change,
     * no responseReceivedAt, no agencyTrackingNumber. The FOIA reads as unanswered,
     * the escalation clock keeps running, and the tracking number the agency told us
     * to quote on every follow-up is thrown away. UNRELATED is also the one class
     * that leaves nothing for a human to review.
     */
    const r = classifyMailDeterministic({
      from: "\"'LAFPP_CPRA' via Proposals\" <proposals@horustech.dev>",
      subject: 'We have received your CPRA / FOIA request. CPRA-0319',
      body: [
        'Thank you for',
        'your California Public Records Act (CPRA) inquiry. Your request number',
        'is CPRA-0319. Please reference your request',
        'number for any follow-up.',
        '',
        'LAFPP staff will be contacting you within ten days regarding your',
        'request. In the meantime, please note that responsive records are provided via',
        'email.',
      ].join('\n'),
    });

    expect(r.classification).toBe('FOIA_RESPONSE');
    expect(r.trackingNumber).toBe('CPRA-0319');
  });

  it('treats an agency forwarding our request internally as a reply, not as ours', () => {
    /**
     * Real message obc93sn2d5kk, from the live mailbox (2026-08-17).
     *
     * A buyer at San Bernardino City USD replied to our PRA request and copied a
     * colleague, quoting our letter in full below her own two lines. Her own words
     * match NONE of the FOIA_RESPONSE patterns — she never writes "in receipt of",
     * "in response to", or a tracking number — while our quoted letter matches two
     * OUTBOUND_MARKERS (`pursuant-to-act`, `copies-of-following`). The outbound gate
     * fires first, so a genuine agency reply is filed as our own outgoing request.
     *
     * Consequence: OWN_REQUEST_LOGGED changes no state and records no
     * responseReceivedAt, so a real agency response is invisible. The request looks
     * unanswered, the escalation clock keeps running, and a duplicate follow-up
     * gets sent to an agency that already engaged. Note the sender is on a `.k12.ca.us`
     * domain — `gov-sender` was matched and then ignored.
     *
     * This is the same class as the "agency reply quoting our request" case above,
     * which passes only because that agency happened to use recognised phrasing.
     */
    const r = classifyMailDeterministic({
      from: '"Jeanette MartinezCastaneda (Purchasing Department)" <jeanette.martinezcastaneda@sbcusd.k12.ca.us>',
      subject:
        'Re: California Public Records Act Request – RFP No . 26-22, Data Management and Business Intelligence Platform  Solution',
      body: [
        'Hi Krystal,',
        '',
        'I am forwarding you the request for records I received.',
        '',
        'Kind regards,',
        'Jeanette Martinez-Castañeda',
        'Buyer - Purchasing Department',
        '',
        'On Mon, Aug 17, 2026 at 10:33 AM Brennen Stones <brennen@horustech.dev> wrote:',
        '',
        '> To the Public Records Custodian:',
        '>',
        '> Pursuant to the California Public Records Act, Government Code section',
        '> 7920.000 et seq. (formerly Government Code section 6250 et seq.), I am',
        '> requesting copies of the following public records related to RFP No. 26-22,',
        '> Data Management and Business Intelligence Platform Solution, issued by San',
        '> Bernardino City Unified School District ("District"):',
        '>',
        '> 1. All evaluator scoresheets and individual evaluator scores for RFP No. 26-22;',
      ].join('\n'),
    });

    expect(r.classification).toBe('FOIA_RESPONSE');
  });

  it('does not read our own generated letter as an agency reply', () => {
    // Regression: "responsive records" appears three times in our own template,
    // and matching that phrase alone made every outbound letter classify as a
    // FOIA_RESPONSE — which would mark a request answered that was never sent.
    // Reply markers must describe what only an agency does: attach records,
    // report having located them, or acknowledge receipt of ours.
    const ourLetterBody = [
      'This is a request under the Texas Public Information Act (PIA).',
      'This request pertains to Solicitation No. RFP 739-SL3722874.',
      'I will pay reasonable statutory charges for responsive records.',
      'I request that responsive records be provided in electronic format.',
    ].join('\n');

    const r = real('Texas Public Information Act Request — RFP 739-SL3722874', ourLetterBody);

    expect(r.classification).toBe('OUR_OWN_REQUEST');
    expect(r.confidence).toBe('HIGH');
  });

  it('recognises "Award(s) Published" — the parenthesised plural', () => {
    /**
     * Real BidNet subject line, and the THIRD distinct award phrasing that real
     * mail exposed as a miss (after "Notification of Award" and the loss-side
     * wording). It classified as UNRELATED, i.e. the actual trigger this feature
     * exists to catch was being discarded.
     *
     * The trap is that `(s)` is literal text, so `\baward(ed)?\b` cannot match
     * "Award(s)" — the pattern reads it as an optional "ed" suffix.
     */
    const r = real(
      'Award(s) Published for HACSC2026-RFP-03 - REQUEST FOR PROPOSALS FOR WEBSITE DESIGN',
      'An award has been published for this solicitation.',
    );

    expect(r.classification).toBe('AWARD_NOTICE');
  });

  it('treats a bid-results announcement as an award notice', () => {
    // Substantively an award: it names the winner. Previously IGNORED.
    const r = real(
      'Bid Results Published for BID #28-2026 - OFFICE AND PRINTING SUPPLIES',
      'Bid results are now available.',
    );

    expect(r.classification).toBe('AWARD_NOTICE');
  });

  it('treats the real 4142 message as an award retraction, not a cancellation', () => {
    /**
     * This test previously asserted SOLICITATION_CANCELLED with a hand-written body
     * ("The award for this solicitation has been cancelled by the agency"), while
     * only its subject came from the archive. Reading the real message
     * (`57k9ipvt8le8`) shows the body is a BidNet award-posting retraction:
     *
     *   "The following award has been cancelled:
     *      - Solicitation : 4142 - SolarWinds Renewal
     *      - Award Type: Award
     *      - Award Publication Date: 06/12/2026 12:42 PM EDT"
     *
     * The solicitation is alive and a new award will follow, so SOLICITATION_CANCELLED
     * was the wrong verdict — and the harmful one. Replay confirmed that with an
     * opportunity numbered 4142 present, it produced `SUPPRESSED`: the FOIA automation
     * withdrawn precisely when an award is coming. It escaped only because we hold no
     * such opportunity.
     *
     * Recorded as award-side news so a human sees it; it cannot act on its own, since
     * no award date is stated and the receipt-date fallback is refused by the
     * `RECORDED_AWARD` guard.
     */
    const r = real(
      '"Award" for the 4142 solicitation has been cancelled',
      [
        'Michael Walker, The following award has been cancelled:',
        '   - Solicitation : 4142 - SolarWinds Renewal',
        '   - Award Type: Award',
        '   - Award Publication Date: 06/12/2026 12:42 PM EDT',
      ].join('\n'),
    );

    expect(r.classification).not.toBe('SOLICITATION_CANCELLED');
    expect(r.matchedOn).toContain('award-retracted');
    // Still not actionable: nothing may move a schedule off a retraction.
    expect(canActAutomatically(r)).toBe(false);
  });

  /**
   * A retraction must name the AWARD as the thing cancelled.
   *
   * `Award Type: Award` alone was matched as a retraction, but BidNet emits that
   * structured field on cancellation postings too — so a genuine cancellation carrying
   * it was reclassified SOLICITATION_CANCELLED → AWARD_NOTICE. Because that path can
   * act unattended, it went on to record an award and re-anchor the FOIA timer on a
   * dead solicitation: the same inversion the retraction list exists to prevent,
   * pointed the other way.
   *
   * The test above still passes on the real 4142 message, which says "award … has been
   * cancelled" — so removing the bare field test costs no coverage.
   */
  it('does not let a bare "Award Type: Award" field hijack a real cancellation', () => {
    const r = real(
      'Solicitation 4142 cancelled',
      [
        'The following solicitation has been cancelled.',
        '   - Award Type: Award',
        '   - Solicitation Number: 4142',
      ].join('\n'),
    );

    expect(r.classification).toBe('SOLICITATION_CANCELLED');
    expect(r.matchedOn).not.toContain('award-retracted');
  });

  it('recognises the "Cancelled:" subject prefix agencies use', () => {
    const r = real(
      'Cancelled: 26-061 - Digital Training Log and Certification of Public Works',
      'This solicitation has been cancelled.',
    );

    expect(r.classification).toBe('SOLICITATION_CANCELLED');
  });

  it('reads a South Carolina agency reply as a reply, not a cancellation', () => {
    // Real message from mmo.sc.gov. Its opening is the tell; without those markers
    // the cancellation wording inside would have made it a suppression trigger.
    const r = real(
      '[External] Freedom of Information Act Request – Solicitation No. 5400028096, DNR Website and Hosting',
      'Our office has received your request regarding Solicitation #5400028096.',
    );

    expect(r.classification).toBe('FOIA_RESPONSE');
    expect(canActAutomatically(r)).toBe(false);
  });

  it('does not read our letter\'s document list as an award announcement', () => {
    /**
     * From the real archive. Our request itemises "the notice of award and the
     * awarded contract value" as a record to produce — indistinguishable from an
     * agency announcing an award unless the request context is read. This one was
     * classified AWARD_NOTICE, which is the class that can move a FOIA schedule.
     */
    const r = real(
      'California Public Records Act Request – IFB C25910004, Lifeguard Dispatch Software Services',
      'Pursuant to the California Public Records Act, the undersigned requests copies of the ' +
        'following public records: 1. The bid tabulation. 4. The notice of award and the awarded ' +
        'contract value (total bid amount and any Standard Agreement).',
    );

    expect(r.classification).toBe('OUR_OWN_REQUEST');
  });

  it('reads an agency reply about a cancellation as a reply, not a trigger', () => {
    /**
     * Also from the real archive, and the more dangerous of the two. This is the
     * agency ANSWERING a request we filed, and mentioning that the solicitation was
     * cancelled. Classified as SOLICITATION_CANCELLED it would suppress the
     * automation off the agency's own reply — silently, since a suppression has no
     * later correction.
     */
    const r = real(
      '[External] Freedom of Information Act Request – Solicitation No. 5400028096, DNR Website and Hosting',
      'Our office has received your request regarding Solicitation #5400028096. This ' +
        'solicitation was cancelled after opening but before award with the intent to resolicit.',
    );

    expect(r.classification).toBe('FOIA_RESPONSE');
    expect(canActAutomatically(r)).toBe(false);
  });

  it('recognises the California response letter wording', () => {
    const r = real(
      'Public Records Act Request – 26-528 – IFB C25910004',
      'This letter is in further response to your Public Records Act ("PRA"), received ' +
        'request via e-mail on July 9, 2026, in which you request: ...',
    );

    expect(r.classification).toBe('FOIA_RESPONSE');
    expect(r.trackingNumber).toBe('26-528');
  });
});

describe('unrelated mail', () => {
  it('ignores ordinary commercial mail', () => {
    const r = classifyMailDeterministic(
      mail({
        from: 'newsletter@vendor.com',
        subject: 'Our latest webinar',
        body: 'Join us to learn about cloud migration.',
      }),
    );

    expect(r.classification).toBe('UNRELATED');
    expect(canActAutomatically(r)).toBe(false);
  });

  it('marks a solicitation-ish message with an id as OTHER, not a trigger', () => {
    const r = classifyMailDeterministic(
      mail({
        subject: 'Amendment 0002 to W912DY-24-R-0001',
        body: 'The due date has been extended.',
      }),
    );

    expect(r.classification).toBe('OTHER_SOLICITATION');
    expect(canActAutomatically(r)).toBe(false);
  });

  it('never auto-acts on anything below HIGH confidence', () => {
    for (const confidence of ['MEDIUM', 'LOW'] as const) {
      expect(
        canActAutomatically({
          classification: 'AWARD_NOTICE',
          confidence,
          matchedOn: [],
          solicitationNumber: 'W912DY-24-R-0001',
        }),
      ).toBe(false);
    }
  });
});
