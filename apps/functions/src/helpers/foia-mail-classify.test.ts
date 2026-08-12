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
