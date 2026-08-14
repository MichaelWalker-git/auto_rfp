import {
  coreSolicitationNumber,
  correlateMailToOpportunities,
  isCorrelatableSolicitationNumber,
  resolveSingleCorrelation,
  type CorrelationCandidate,
} from './foia-mail-correlate';

const opp = (solicitationNumber: string, oppId = 'opp-1'): CorrelationCandidate => ({
  oppId,
  orgId: 'org-1',
  projectId: 'proj-1',
  solicitationNumber,
});

describe('coreSolicitationNumber', () => {
  it('strips a single label prefix', () => {
    expect(coreSolicitationNumber('RFP 739-SL3722874')).toBe('739-SL3722874');
    expect(coreSolicitationNumber('IFB C25910004')).toBe('C25910004');
    expect(coreSolicitationNumber('Solicitation W912DY-24-R-0001')).toBe('W912DY-24-R-0001');
  });

  it('strips stacked prefixes', () => {
    // Verbatim from a real San Bernardino evaluation tabulation header.
    expect(coreSolicitationNumber('GEN No. RFP No. 26-16')).toBe('26-16');
  });

  it('leaves a bare identifier untouched', () => {
    expect(coreSolicitationNumber('26COR-072')).toBe('26COR-072');
    expect(coreSolicitationNumber('693JK426R600002')).toBe('693JK426R600002');
  });

  it('keeps a run-on prefix that is part of the identifier', () => {
    // "RFP194982" (a real stored value) has no separator after the label, so
    // there is no word boundary to strip at — and it must stay intact, because
    // that is the form the agency writes it in.
    expect(coreSolicitationNumber('RFP194982')).toBe('RFP194982');
    expect(
      correlateMailToOpportunities('Award for RFP194982 posted.', [opp('RFP194982')]),
    ).toHaveLength(1);
  });
});

describe('isCorrelatableSolicitationNumber', () => {
  it('accepts real solicitation numbers', () => {
    for (const n of [
      'RFP 739-SL3722874',
      'IFB C25910004',
      '26COR-072',
      '693JK426R600002',
      'W912DY-24-R-0001',
      '36C24826Q0460',
    ]) {
      expect(isCorrelatableSolicitationNumber(n)).toBe(true);
    }
  });

  it('rejects placeholders and machine-generated ids', () => {
    // All of these are really in the live table and would otherwise correlate
    // dozens of unrelated opportunities to the same message.
    for (const n of ['N/A', 'NONE', 'TBD', 'ABC-123', 'BATCH-1769606073902', '', undefined, null]) {
      expect(isCorrelatableSolicitationNumber(n)).toBe(false);
    }
  });

  it('rejects anything too short to identify a solicitation', () => {
    expect(isCorrelatableSolicitationNumber('12')).toBe(false);
    expect(isCorrelatableSolicitationNumber('RFP 1')).toBe(false);
  });
});

describe('correlation against real agency mail', () => {
  it('correlates a state university award notice', () => {
    // Body text taken from the real TTUHSC "Notification of Award" email.
    const body =
      'Notification of Award: RFP 739-SL3732580 - AI-Enhanced Dictation and Transcription ' +
      'Solution. Solicitation ID: 739-SL3732580 Status: Awarded Award Date 1/29/2026';

    const matches = correlateMailToOpportunities(body, [opp('RFP 739-SL3732580')]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchedNumber).toBe('RFP 739-SL3732580');
  });

  it('correlates across differing punctuation', () => {
    // The same VA solicitation is written both ways in practice.
    const matches = correlateMailToOpportunities(
      'Award Notice 36C248-26-Q-0460 has been posted.',
      [opp('36C24826Q0460')],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchedBy).toBe('NORMALIZED_SUBSTRING');
  });

  it('correlates a California IFB quoted in a PRA response', () => {
    const body =
      'copies of the following public records related to Invitation for Bid (IFB) ' +
      'C25910004, "Lifeguard Dispatch Software Services"';

    expect(correlateMailToOpportunities(body, [opp('IFB C25910004')])).toHaveLength(1);
  });

  it('correlates a loss notice', () => {
    const matches = correlateMailToOpportunities(
      'Your proposal for W912P626X1CCN was not selected for award.',
      [opp('W912P626X1CCN')],
    );

    expect(matches).toHaveLength(1);
  });

  it('does not correlate unrelated mail', () => {
    const matches = correlateMailToOpportunities('Join our webinar on cloud migration.', [
      opp('RFP 739-SL3732580'),
      opp('26COR-072', 'opp-2'),
    ]);

    expect(matches).toEqual([]);
  });
});

describe('false-positive safety', () => {
  it('does not match a short number inside a longer one', () => {
    // "4713" appears inside "44713". A normalized substring search would match;
    // boundary-anchored literal matching must not.
    expect(correlateMailToOpportunities('Invoice total 44713 dollars.', [opp('4713')])).toEqual([]);
  });

  it('does not match a short number inside a longer decimal', () => {
    expect(correlateMailToOpportunities('reference 26.104 applies', [opp('RFP #26.10')])).toEqual(
      [],
    );
  });

  it('still matches a short number standing alone', () => {
    const matches = correlateMailToOpportunities('Award for 4713 is final.', [opp('4713')]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchedBy).toBe('LITERAL_BOUNDARY');
  });

  it('ignores placeholder-numbered opportunities entirely', () => {
    // Without this, every batch-uploaded opportunity would match any message
    // that happened to contain its id-like text.
    const candidates = [
      opp('N/A', 'opp-a'),
      opp('BATCH-1769606073902', 'opp-b'),
      opp('ABC-123', 'opp-c'),
    ];

    expect(
      correlateMailToOpportunities('Award notice for N/A ABC-123 BATCH-1769606073902', candidates),
    ).toEqual([]);
  });
});

describe('ambiguity is a refusal', () => {
  const twoOpps = [opp('W912DY-24-R-0001', 'opp-1'), opp('SP4701-25-Q-0123', 'opp-2')];
  const body = 'Amendment covering W912DY-24-R-0001 and SP4701-25-Q-0123 has been issued.';

  it('reports every match', () => {
    expect(correlateMailToOpportunities(body, twoOpps)).toHaveLength(2);
  });

  it('refuses to pick one when several match', () => {
    // Taking the first would attach the notice to the wrong opportunity and file
    // a statutory request against the wrong agency.
    expect(resolveSingleCorrelation(body, twoOpps)).toBeNull();
  });

  it('resolves when exactly one matches', () => {
    const single = resolveSingleCorrelation('Award for W912DY-24-R-0001.', twoOpps);

    expect(single?.candidate.oppId).toBe('opp-1');
  });

  it('returns null when nothing matches', () => {
    expect(resolveSingleCorrelation('unrelated', twoOpps)).toBeNull();
  });

  it('reports a duplicated candidate only once', () => {
    const duplicated = [opp('W912DY-24-R-0001'), opp('W912DY-24-R-0001')];

    expect(correlateMailToOpportunities('Award W912DY-24-R-0001', duplicated)).toHaveLength(1);
    expect(resolveSingleCorrelation('Award W912DY-24-R-0001', duplicated)).not.toBeNull();
  });
});
