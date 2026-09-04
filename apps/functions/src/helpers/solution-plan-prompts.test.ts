/**
 * Tests for the Solution Plan prompt builders (T6) — pure functions, no mocks.
 */
import type { DocSummary, SolicitationBundle } from '@auto-rfp/core';

import {
  GRILLER_BRIEF_CHAR_CAP,
  GRILLER_SOLICITATION_CHAR_CAP,
  INTERVIEW_COMPLETE_TOKEN,
  SYNTHESIS_TARGET_BODY_CHARS,
  TECH_LEAD_PRIMER_CHAR_CAP,
  buildGrillerStablePrompt,
  buildGrillerSystemPrompt,
  buildGrillerUserPrompt,
  buildGrillerVariablePrompt,
  buildSolicitationManifest,
  buildSynthesizerSystemPrompt,
  buildSynthesizerUserPrompt,
  buildTechLeadStablePrompt,
  buildTechLeadSystemPrompt,
  buildTechLeadUserPrompt,
  buildTechLeadVariablePrompt,
  formatTranscript,
  solicitationTextForBundle,
  type TranscriptEntry,
} from './solution-plan-prompts';

const transcript: TranscriptEntry[] = [
  { role: 'GRILLER', content: 'What is the hosting architecture?' },
  { role: 'TECH_LEAD', content: 'AWS GovCloud, ECS Fargate.' },
  { role: 'SYSTEM', content: 'Round boundary marker' },
];

describe('constants', () => {
  it('exposes the expected context caps', () => {
    expect(INTERVIEW_COMPLETE_TOKEN).toBe('INTERVIEW_COMPLETE');
    expect(GRILLER_SOLICITATION_CHAR_CAP).toBe(150_000);
    expect(GRILLER_BRIEF_CHAR_CAP).toBe(8_000);
    expect(TECH_LEAD_PRIMER_CHAR_CAP).toBe(150_000);
    expect(SYNTHESIS_TARGET_BODY_CHARS).toBe(10_000);
  });
});

describe('formatTranscript', () => {
  it('renders GRILLER/TECH_LEAD turns and omits SYSTEM entries', () => {
    const formatted = formatTranscript(transcript);
    expect(formatted).toContain('INTERVIEWER:\nWhat is the hosting architecture?');
    expect(formatted).toContain('TECH LEAD:\nAWS GovCloud, ECS Fargate.');
    expect(formatted).not.toContain('Round boundary marker');
  });

  it('returns an empty string for an empty transcript', () => {
    expect(formatTranscript([])).toBe('');
  });
});

describe('buildGrillerSystemPrompt', () => {
  it('instructs 1-3 questions and defines the termination token', () => {
    const prompt = buildGrillerSystemPrompt();
    expect(prompt).toContain('1-3');
    expect(prompt).toContain(INTERVIEW_COMPLETE_TOKEN);
  });

  it('treats the bid decision as out of scope — the org is bidding', () => {
    const prompt = buildGrillerSystemPrompt();
    expect(prompt).toContain('IS bidding');
    expect(prompt).toContain('Never ask whether to bid');
  });
});

describe('buildGrillerUserPrompt', () => {
  const baseArgs = {
    solicitationText: 'SOLICITATION BODY',
    execBriefText: 'BRIEF BODY',
    transcript,
    round: 2,
    maxRounds: 4,
  };

  it('includes solicitation, brief, and transcript sections', () => {
    const prompt = buildGrillerUserPrompt(baseArgs);
    expect(prompt).toContain('SOLICITATION BODY');
    expect(prompt).toContain('EXECUTIVE BRIEF ANALYSIS');
    expect(prompt).toContain('BRIEF BODY');
    expect(prompt).toContain('INTERVIEW SO FAR');
    expect(prompt).toContain('ROUND 2 OF 4');
  });

  it('omits the exec brief section entirely when no brief exists (ADR-14)', () => {
    const prompt = buildGrillerUserPrompt({ ...baseArgs, execBriefText: '' });
    expect(prompt).not.toContain('EXECUTIVE BRIEF ANALYSIS');
  });

  it('does not offer termination in round 1', () => {
    const prompt = buildGrillerUserPrompt({ ...baseArgs, transcript: [], round: 1 });
    expect(prompt).toContain('Open the interview');
    // The round instruction must not tell the model it can terminate yet
    const instruction = prompt.split('YOUR TURN')[1] ?? '';
    expect(instruction).not.toContain(INTERVIEW_COMPLETE_TOKEN);
  });

  it('asks final questions on the last round instead of skipping its Q&A (ADR-13)', () => {
    const prompt = buildGrillerUserPrompt({ ...baseArgs, round: 4 });
    expect(prompt).toContain('FINAL round');
    expect(prompt).toContain('most critical unresolved questions');
    // Termination is forced by the worker AFTER the final Tech Lead turn — the
    // prompt must not pre-empt the final round's Q&A by demanding the token.
    expect(prompt).not.toContain('MUST output the single token');
    // The token stays available in case every area is already answered
    expect(prompt).toContain(INTERVIEW_COMPLETE_TOKEN);
  });
});

describe('buildTechLeadSystemPrompt', () => {
  it('demands concrete decisions and JSON output', () => {
    const prompt = buildTechLeadSystemPrompt();
    expect(prompt).toContain('CONCRETE');
    expect(prompt).toContain('"it depends"');
    expect(prompt).toContain('{"answer"');
    expect(prompt).toContain('vendor quote required');
  });

  it('forbids no-bid recommendations — the bid decision is out of scope', () => {
    const prompt = buildTechLeadSystemPrompt();
    expect(prompt).toContain('IS submitting a proposal');
    expect(prompt).toContain('Never recommend a no-bid');
  });
});

describe('buildTechLeadUserPrompt', () => {
  it('includes primer, transcript, and the current questions', () => {
    const prompt = buildTechLeadUserPrompt({
      opportunityPrimer: 'PRIMER TEXT',
      transcript,
      currentQuestions: 'Q1: How many FTEs?',
      round: 3,
    });
    expect(prompt).toContain('PRIMER TEXT');
    expect(prompt).toContain('INTERVIEW SO FAR');
    expect(prompt).toContain('Q1: How many FTEs?');
    expect(prompt).toContain('ROUND 3');
  });
});

describe('buildSynthesizerSystemPrompt', () => {
  it('requires the six SoT sections and the JSON output shape', () => {
    const prompt = buildSynthesizerSystemPrompt();
    for (const section of [
      'Solution Architecture',
      'Selected Services & Licenses',
      'Timeline & Phases',
      'Team Composition',
      'Key Risks',
      'Cost Drivers & Assumptions',
    ]) {
      expect(prompt).toContain(section);
    }
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"htmlContent"');
  });

  it('targets ~10k chars of body text (ADR-6)', () => {
    expect(buildSynthesizerSystemPrompt()).toContain('10,000');
  });

  it('forbids bid/no-bid statements in the plan — the org is assumed bidding', () => {
    const prompt = buildSynthesizerSystemPrompt();
    expect(prompt).toContain('IS bidding');
    expect(prompt).toContain('NEVER state a bid, no-bid, go, or no-go decision');
    expect(prompt).toContain('NEVER write that no proposal or ROM will be submitted');
  });
  it('requires the costSchedule in the output shape with the billing enum', () => {
    const prompt = buildSynthesizerSystemPrompt();
    expect(prompt).toContain('"costSchedule"');
    expect(prompt).toContain('COST SCHEDULE RULES');
    for (const token of ['ONE_TIME', 'MONTHLY', 'ANNUAL', 'LABOR', 'THIRD_PARTY', 'ODC', 'OTHER']) {
      expect(prompt).toContain(token);
    }
  });

  it('requires the optional flag in the item shape and the option-CLIN rule', () => {
    const prompt = buildSynthesizerSystemPrompt();
    expect(prompt).toContain('"optional": <boolean>');
    expect(prompt).toContain('Set "optional": true for option CLINs');
    expect(prompt).toContain('excluded from the totals server-side');
  });

  it('demands every plan cost as an item, including own-service/labor costs, with no invented numbers', () => {
    const prompt = buildSynthesizerSystemPrompt();
    expect(prompt).toContain('Selected Services & Licenses');
    expect(prompt).toContain('Cost Drivers & Assumptions');
    expect(prompt).toContain('labor-based costs');
    expect(prompt).toContain('null when the price is "vendor quote required"');
    expect(prompt).toContain('recomputed server-side');
  });
});

describe('buildSynthesizerUserPrompt', () => {
  it('includes the primer and the formatted transcript', () => {
    const prompt = buildSynthesizerUserPrompt({
      opportunityPrimer: 'PRIMER TEXT',
      transcript,
    });
    expect(prompt).toContain('PRIMER TEXT');
    expect(prompt).toContain('INTERVIEW TRANSCRIPT');
    expect(prompt).toContain('AWS GovCloud, ECS Fargate.');
  });

  it('omits the primer section when empty', () => {
    const prompt = buildSynthesizerUserPrompt({ opportunityPrimer: '', transcript });
    expect(prompt).not.toContain('OPPORTUNITY PRIMER');
  });
});

describe('buildGrillerStablePrompt / buildGrillerVariablePrompt (Layer A caching split)', () => {
  const args = {
    solicitationText: 'SOLICITATION TEXT',
    execBriefText: 'BRIEF TEXT',
    transcript,
    round: 2,
    maxRounds: 4,
  };

  it('concatenating stable + variable reproduces buildGrillerUserPrompt', () => {
    const combined = [buildGrillerStablePrompt(args), buildGrillerVariablePrompt(args)].join('\n\n');
    expect(combined).toBe(buildGrillerUserPrompt(args));
  });

  it('keeps the solicitation and exec brief in the stable half, round framing in the variable half', () => {
    const stable = buildGrillerStablePrompt(args);
    const variable = buildGrillerVariablePrompt(args);
    expect(stable).toContain('SOLICITATION TEXT');
    expect(stable).toContain('BRIEF TEXT');
    expect(stable).not.toContain('ROUND 2 OF 4');
    expect(variable).toContain('ROUND 2 OF 4');
    expect(variable).not.toContain('SOLICITATION TEXT');
  });

  it('the stable half never changes across rounds — only the variable half does', () => {
    const round3 = buildGrillerVariablePrompt({ ...args, round: 3 });
    expect(buildGrillerStablePrompt(args)).toBe(buildGrillerStablePrompt({ ...args, round: 3 } as never));
    expect(round3).not.toBe(buildGrillerVariablePrompt(args));
  });
});

describe('buildTechLeadStablePrompt / buildTechLeadVariablePrompt (Layer A caching split)', () => {
  const fullArgs = {
    opportunityPrimer: 'PRIMER TEXT',
    transcript,
    currentQuestions: 'Q2: What is the team mix?',
    round: 2,
  };

  it('concatenating stable + variable reproduces buildTechLeadUserPrompt', () => {
    const combined = [
      buildTechLeadStablePrompt(fullArgs.opportunityPrimer),
      buildTechLeadVariablePrompt(fullArgs),
    ].join('\n\n');
    expect(combined).toBe(buildTechLeadUserPrompt(fullArgs));
  });

  it('keeps the primer in the stable half, the current round in the variable half', () => {
    const stable = buildTechLeadStablePrompt(fullArgs.opportunityPrimer);
    const variable = buildTechLeadVariablePrompt(fullArgs);
    expect(stable).toContain('PRIMER TEXT');
    expect(stable).not.toContain('team mix');
    expect(variable).toContain('team mix');
    expect(variable).not.toContain('PRIMER TEXT');
  });
});

describe('buildSolicitationManifest', () => {
  const summaries: DocSummary[] = [
    { name: 'RFP.pdf', chars: 120_000, summary: 'The base solicitation.', sections: ['Scope', 'Pricing'] },
    { name: 'Attachment A.pdf', chars: 45_000, summary: 'Wage determination.', sections: [] },
  ];

  it('lists every document with its summary and sections', () => {
    const manifest = buildSolicitationManifest(summaries, 165_000);
    expect(manifest).toContain('DOCUMENT MANIFEST (2 document(s), 165,000 chars total)');
    expect(manifest).toContain('RFP.pdf (120,000 chars)');
    expect(manifest).toContain('Summary: The base solicitation.');
    expect(manifest).toContain('Sections: Scope; Pricing');
    expect(manifest).toContain('Attachment A.pdf (45,000 chars)');
    expect(manifest).toContain('Summary: Wage determination.');
    expect(manifest).toContain('fetch_solicitation_section');
  });

  it('omits the Sections line for a document with no detected sections', () => {
    const manifest = buildSolicitationManifest(summaries, 165_000);
    const attachmentBlock = manifest.split('--- Document: Attachment A.pdf')[1]!;
    expect(attachmentBlock).not.toContain('Sections:');
  });
});

describe('solicitationTextForBundle', () => {
  it('returns the raw text for a FULL bundle', () => {
    const bundle: SolicitationBundle = {
      strategy: 'FULL',
      text: 'full solicitation text',
      documents: [{ name: 'RFP.pdf', chars: 23 }],
    };
    expect(solicitationTextForBundle(bundle)).toBe('full solicitation text');
  });

  it('returns the manifest for a SUMMARIZED bundle', () => {
    const bundle: SolicitationBundle = {
      strategy: 'SUMMARIZED',
      summaries: [{ name: 'RFP.pdf', chars: 200_000, summary: 'Big RFP.', sections: ['Scope'] }],
      totalChars: 200_000,
    };
    const text = solicitationTextForBundle(bundle);
    expect(text).toContain('DOCUMENT MANIFEST');
    expect(text).toContain('Big RFP.');
  });
});
