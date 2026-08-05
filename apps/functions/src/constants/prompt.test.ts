const mockReadSystemPrompt = jest.fn();
const mockReadUserPrompt = jest.fn();

jest.mock('@/helpers/prompt', () => ({
  readSystemPrompt: (...args: unknown[]) => mockReadSystemPrompt(...args),
  readUserPrompt: (...args: unknown[]) => mockReadUserPrompt(...args),
}));

import {
  SCORING_SYSTEM_PROMPT,
  SCORING_USER_PROMPT,
  generateDataStatusFlags,
  useScoringUserPrompt,
} from './prompt';

describe('SCORING_SYSTEM_PROMPT content', () => {
  it('contains the STEP 0 deliverable classification block', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('STEP 0 — DELIVERABLE CLASSIFICATION');
    expect(SCORING_SYSTEM_PROMPT).toContain('BUILDABLE_SOFTWARE');
    expect(SCORING_SYSTEM_PROMPT).toContain('OUT_OF_DOMAIN');
  });

  it('contains the BUILDABLE SOFTWARE DECISION FLOOR rule', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('BUILDABLE SOFTWARE DECISION FLOOR');
  });

  it('forbids lowering TECHNICAL_FIT for a COTS request', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain(
      'Do NOT lower TECHNICAL_FIT because the buyer requested a COTS',
    );
    expect(SCORING_SYSTEM_PROMPT).toContain('capability');
    expect(SCORING_SYSTEM_PROMPT).toContain('to BUILD the system');
  });

  it('classifies COTS software procurements as BUILDABLE_SOFTWARE with no borderline category', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('SOFTWARE procurements');
    expect(SCORING_SYSTEM_PROMPT).toContain('STILL');
    expect(SCORING_SYSTEM_PROMPT).toContain('Classify by what the system DOES');
    expect(SCORING_SYSTEM_PROMPT).toContain('NEVER');
    expect(SCORING_SYSTEM_PROMPT).toContain('"borderline"');
  });

  it('lists product-gate items that are never TECHNICAL_FIT deductions', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('NEVER TECHNICAL_FIT deductions');
    expect(SCORING_SYSTEM_PROMPT).toContain('capability matrix');
    expect(SCORING_SYSTEM_PROMPT).toContain('a working POC demo answers these');
  });

  it('declares COTS/product-ownership gates are never hard blockers', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain(
      'PRODUCT-OWNERSHIP / COTS GATES ARE NEVER HARD BLOCKERS',
    );
    expect(SCORING_SYSTEM_PROMPT).toContain('Do NOT use these gates to justify NO_GO');
    // old narrower rule must be gone
    expect(SCORING_SYSTEM_PROMPT).not.toContain('hard blocker ONLY when the');
    expect(SCORING_SYSTEM_PROMPT).not.toContain('explicitly FORBIDS custom-built solutions');
  });

  it('limits hard blockers to deadline, set-aside, sole-source, and clearance', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('HARD BLOCKERS for BUILDABLE_SOFTWARE are ONLY');
    expect(SCORING_SYSTEM_PROMPT).toContain('expired submission deadline');
    expect(SCORING_SYSTEM_PROMPT).toContain('ineligible set-aside');
    expect(SCORING_SYSTEM_PROMPT).toContain('sole-source or otherwise closed competition');
    expect(SCORING_SYSTEM_PROMPT).toContain('Nothing else is a hard blocker');
  });

  it('treats experience minimums as demonstration-solvable via POC, resumes, and past projects', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('EXPERIENCE MINIMUMS ARE DEMONSTRATION-SOLVABLE');
    expect(SCORING_SYSTEM_PROMPT).toContain('POC-DEMONSTRATION LENS');
    expect(SCORING_SYSTEM_PROMPT).toContain('senior engineer resumes');
    expect(SCORING_SYSTEM_PROMPT).toContain('proof-of-concept');
  });

  it('credits same-component-type experience in TECHNICAL_FIT and PAST_PERFORMANCE_RELEVANCE', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('COMPONENT-TYPE CREDIT');
    expect(SCORING_SYSTEM_PROMPT).toContain('SAME COMPONENT TYPE');
    expect(SCORING_SYSTEM_PROMPT).toContain(
      'never inferred from the KB',
    );
  });

  it('retains anti-hallucination honesty rules', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('PAST_PERFORMANCE_RELEVANCE score MUST be 1');
    expect(SCORING_SYSTEM_PROMPT).toContain('NEVER claim experience');
    expect(SCORING_SYSTEM_PROMPT).toContain('Do NOT invent, assume, or infer capabilities');
  });

  it('no longer contains the removed blanket industry-mismatch rule', () => {
    expect(SCORING_SYSTEM_PROMPT).not.toContain(
      "If the company's KB capabilities do NOT match the solicitation's industry/domain",
    );
  });

  it('keeps all 5 criterion names and their weights unchanged', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('TECHNICAL_FIT (20% weight)');
    expect(SCORING_SYSTEM_PROMPT).toContain('PAST_PERFORMANCE_RELEVANCE (30% weight)');
    expect(SCORING_SYSTEM_PROMPT).toContain('PRICING_POSITION');
    expect(SCORING_SYSTEM_PROMPT).toContain('STRATEGIC_ALIGNMENT');
    expect(SCORING_SYSTEM_PROMPT).toContain('INCUMBENT_RISK');
  });
});

describe('SCORING_USER_PROMPT content', () => {
  it('contains the BUILDABLE SOFTWARE OVERRIDE in decision logic', () => {
    expect(SCORING_USER_PROMPT).toContain('BUILDABLE SOFTWARE OVERRIDE');
  });

  it('states that a COTS preference alone does not defeat the override', () => {
    expect(SCORING_USER_PROMPT).toContain('A stated preference for COTS alone');
    expect(SCORING_USER_PROMPT).toContain('does NOT defeat this override');
    expect(SCORING_USER_PROMPT).toContain(
      'Do NOT lower the score because the buyer',
    );
  });

  it('excludes COTS gates and experience minimums from hard blockers in the override', () => {
    expect(SCORING_USER_PROMPT).toContain(
      'COTS/product-ownership gates and experience minimums are NOT hard blockers',
    );
    expect(SCORING_USER_PROMPT).toContain('working POC demo');
    expect(SCORING_USER_PROMPT).toContain('senior engineer resumes');
    expect(SCORING_USER_PROMPT).toContain('sole-source/closed competition');
  });

  it('adds component-type credit anchors to PAST_PERFORMANCE_RELEVANCE', () => {
    expect(SCORING_USER_PROMPT).toContain('COMPONENT-TYPE CREDIT');
    expect(SCORING_USER_PROMPT).toContain('same component type');
    // honesty rule must survive
    expect(SCORING_USER_PROMPT).toContain(
      'if no past performance data exists, score 1',
    );
  });

  it('retains the JSON output skeleton keys', () => {
    expect(SCORING_USER_PROMPT).toContain('"criteria"');
    expect(SCORING_USER_PROMPT).toContain('"compositeScore"');
    expect(SCORING_USER_PROMPT).toContain('"decision"');
    expect(SCORING_USER_PROMPT).toContain('"blockers"');
    expect(SCORING_USER_PROMPT).toContain('"requiredActions"');
  });

  it('retains all template placeholders', () => {
    expect(SCORING_USER_PROMPT).toContain('{{DATA_STATUS_FLAGS}}');
    expect(SCORING_USER_PROMPT).toContain('{{TODAY_DATE}}');
    expect(SCORING_USER_PROMPT).toContain('{{PAST_PERFORMANCE}}');
    expect(SCORING_USER_PROMPT).toContain('{{KB_TEXT}}');
    expect(SCORING_USER_PROMPT).toContain('{{SOLICITATION}}');
  });

  it('retains the base decision bands', () => {
    expect(SCORING_USER_PROMPT).toContain('<2.0 → decision = NO_GO');
  });
});

describe('generateDataStatusFlags', () => {
  describe('past performance missing variants', () => {
    it.each<[string, string | undefined]>([
      ['undefined', undefined],
      ['literal "None"', 'None'],
      ['0 matched projects', 'Analysis complete: 0 matched projects found'],
      ['empty topMatches array', '{"topMatches":[],"summary":"none"}'],
    ])('flags NO_DATA for %s', (_label, pastPerformance) => {
      const flags = generateDataStatusFlags({ pastPerformance });

      expect(flags).toContain('PAST_PERFORMANCE_STATUS: NO_DATA');
      expect(flags).toContain('MUST be 1');
      expect(flags).toContain('MUST NOT');
      expect(flags).toContain('BUILDABLE_SOFTWARE');
    });
  });

  it('flags DATA_AVAILABLE and drops the score-1 mandate when past performance exists', () => {
    const flags = generateDataStatusFlags({
      pastPerformance: '3 matched projects: Transit portal build (2024), rated Excellent.',
    });

    expect(flags).toContain('PAST_PERFORMANCE_STATUS: DATA_AVAILABLE');
    expect(flags).not.toContain('MUST be 1');
  });

  it('includes the component-type credit flag when past performance exists', () => {
    const flags = generateDataStatusFlags({
      pastPerformance: '3 matched projects: Transit portal build (2024), rated Excellent.',
    });

    expect(flags).toContain('COMPONENT-TYPE CREDIT');
    expect(flags).toContain('2-3');
  });

  it('does not include the component-type credit flag when past performance is missing', () => {
    const flags = generateDataStatusFlags({ pastPerformance: undefined });

    expect(flags).not.toContain('COMPONENT-TYPE CREDIT');
    expect(flags).toContain('MUST be 1');
  });

  it('replaces the unconditional dual-1 rule with STEP 0 classification when KB is available', () => {
    const kbText =
      'Company capabilities: full-stack web development, cloud architecture, API integrations, databases.';
    const flags = generateDataStatusFlags({ kbText });

    expect(flags).not.toContain('MUST both be 1');
    expect(flags).toContain('If OUT_OF_DOMAIN');
    expect(flags).toContain('If BUILDABLE_SOFTWARE');
  });

  it('caps TECHNICAL_FIT when KB is absent', () => {
    const flags = generateDataStatusFlags({});

    expect(flags).toContain('TECHNICAL_FIT ≤ 2');
  });

  it('caps confidence when both past performance and KB are absent', () => {
    const flags = generateDataStatusFlags({});

    expect(flags).toContain('confidence ≤ 50');
  });
});

describe('useScoringUserPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadSystemPrompt.mockResolvedValue(null);
    mockReadUserPrompt.mockResolvedValue(null);
  });

  it('substitutes every placeholder and injects NO_DATA flags when called with no data', async () => {
    const result = await useScoringUserPrompt('org-123');

    expect(result).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(result).toContain('PAST_PERFORMANCE_STATUS: NO_DATA');
    expect(result).toContain('COMPANY_KB_STATUS: NO_DATA');
    expect(result).toContain('PRICING_STATUS: NO_DATA');
  });

  it('injects DATA_AVAILABLE flags and the provided texts when data exists', async () => {
    const pastPerformance = '2 matched projects: Statewide permitting system (2023).';
    const kbText =
      'Documented capabilities: web application development, PostgreSQL, AWS cloud hosting, systems integration.';

    const result = await useScoringUserPrompt(
      'org-123',
      'Full solicitation text here',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      pastPerformance,
      kbText,
    );

    expect(result).toContain('PAST_PERFORMANCE_STATUS: DATA_AVAILABLE');
    expect(result).toContain('COMPANY_KB_STATUS: DATA_AVAILABLE');
    expect(result).toContain(pastPerformance);
    expect(result).toContain(kbText);
    expect(result).toContain('Full solicitation text here');
  });

  it('reads the org override prompt with the SCORING type', async () => {
    await useScoringUserPrompt('org-456');

    expect(mockReadUserPrompt).toHaveBeenCalledWith('org-456', 'SCORING');
  });
});
