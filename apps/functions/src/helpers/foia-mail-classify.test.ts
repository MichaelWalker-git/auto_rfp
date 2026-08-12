import {
  canActAutomatically,
  classifyMailDeterministic,
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
