/**
 * Tests for the Solution Plan prompt builders (T6) — pure functions, no mocks.
 */
import {
  GRILLER_BRIEF_CHAR_CAP,
  GRILLER_SOLICITATION_CHAR_CAP,
  INTERVIEW_COMPLETE_TOKEN,
  SYNTHESIS_TARGET_BODY_CHARS,
  TECH_LEAD_PRIMER_CHAR_CAP,
  buildGrillerSystemPrompt,
  buildGrillerUserPrompt,
  buildSynthesizerSystemPrompt,
  buildSynthesizerUserPrompt,
  buildTechLeadSystemPrompt,
  buildTechLeadUserPrompt,
  formatTranscript,
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
    expect(GRILLER_SOLICITATION_CHAR_CAP).toBe(60_000);
    expect(GRILLER_BRIEF_CHAR_CAP).toBe(8_000);
    expect(TECH_LEAD_PRIMER_CHAR_CAP).toBe(10_000);
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

  it('forces the termination token on the final round', () => {
    const prompt = buildGrillerUserPrompt({ ...baseArgs, round: 4 });
    expect(prompt).toContain('FINAL round');
    expect(prompt).toContain(`MUST output the single token ${INTERVIEW_COMPLETE_TOKEN}`);
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
