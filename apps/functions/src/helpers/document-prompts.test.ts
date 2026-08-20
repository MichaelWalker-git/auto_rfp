import {
  buildPricingRulesBlock,
  buildSectionSystemPrompt,
  buildSystemPromptForDocumentType,
  buildUserPromptForDocumentType,
  getDefaultGuidance,
  getDefaultTask,
} from './document-prompts';
import { DocumentPromptTypeSchema, type SolutionPlanCostSchedule } from '@auto-rfp/core';

describe('getDefaultGuidance', () => {
  it('returns the type-specific guidance for a known type', () => {
    const guidance = getDefaultGuidance('COVER_LETTER');
    expect(guidance).toContain('Opening — Addressee & Intent');
    expect(guidance).toContain('WRITING RULES:');
  });

  it('returns non-empty guidance for every overridable document type', () => {
    for (const type of DocumentPromptTypeSchema.options) {
      const guidance = getDefaultGuidance(type);
      expect(guidance.length).toBeGreaterThan(0);
    }
  });

  it('COST_PROPOSAL guidance is standalone (no cross-reference to PRICE_VOLUME)', () => {
    const guidance = getDefaultGuidance('COST_PROPOSAL');
    expect(guidance).not.toContain('see above');
    expect(guidance).not.toContain('Same guidance as');
    expect(guidance).toContain('Pricing Summary');
    expect(guidance).toContain('Basis of Estimate');
    expect(guidance).toContain('Labor Categories & Rates');
    expect(guidance).toContain('Other Direct Costs');
    expect(guidance).toContain('Cost Narrative');
    expect(guidance).toContain('cost certifications and representations');
    expect(guidance).toContain('Third-Party Services & Subscriptions');
  });

  it('falls back to generic guidance for unknown/custom types', () => {
    const guidance = getDefaultGuidance('MY_CUSTOM_TYPE');
    expect(guidance).toContain('Organize content logically for the My Custom Type document type');
  });

  it('returns trimmed text with no leading/trailing whitespace', () => {
    for (const type of DocumentPromptTypeSchema.options) {
      expect(getDefaultGuidance(type)).toBe(getDefaultGuidance(type).trim());
    }
  });
});

describe('getDefaultTask', () => {
  it('returns the type-specific task for a known type', () => {
    const task = getDefaultTask('COST_PROPOSAL');
    expect(task).toContain('YOUR TASK — Cost Proposal:');
    expect(task).toContain('get_pricing_data');
  });

  it('returns non-empty task text for every overridable document type', () => {
    for (const type of DocumentPromptTypeSchema.options) {
      const task = getDefaultTask(type);
      expect(task).toContain('YOUR TASK');
      expect(task.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the generic task for unknown/custom types', () => {
    const task = getDefaultTask('MY_CUSTOM_TYPE');
    expect(task).toContain('YOUR TASK — My Custom Type:');
    expect(task).toContain('ANALYZE the solicitation');
  });

  it('returns trimmed text with no leading/trailing whitespace', () => {
    for (const type of DocumentPromptTypeSchema.options) {
      expect(getDefaultTask(type)).toBe(getDefaultTask(type).trim());
    }
  });
});

describe('builders use the same defaults exposed by the accessors', () => {
  it('buildSystemPromptForDocumentType emits the COST_PROPOSAL default guidance', () => {
    const prompt = buildSystemPromptForDocumentType('COST_PROPOSAL');
    expect(prompt).toContain(getDefaultGuidance('COST_PROPOSAL'));
    expect(prompt).not.toContain('Same guidance as PRICE_VOLUME');
  });

  it('buildUserPromptForDocumentType emits the COST_PROPOSAL default task', () => {
    const prompt = buildUserPromptForDocumentType('COST_PROPOSAL', {
      solicitation: 'solicitation',
      qaText: 'qa',
      enrichedKbText: 'kb',
    });
    expect(prompt).toContain(getDefaultTask('COST_PROPOSAL'));
  });
});

describe('guidance/task overrides', () => {
  const GUIDANCE_OVERRIDE = 'CUSTOM ORG GUIDANCE: always cite ISO 9001.';
  const TASK_OVERRIDE = 'CUSTOM ORG TASK: produce exactly four sections.';

  describe('buildSystemPromptForDocumentType', () => {
    it('substitutes only the guidance fragment, keeping the skeleton intact', () => {
      const prompt = buildSystemPromptForDocumentType('COST_PROPOSAL', null, GUIDANCE_OVERRIDE);

      expect(prompt).toContain(GUIDANCE_OVERRIDE);
      expect(prompt).not.toContain(getDefaultGuidance('COST_PROPOSAL'));
      // Skeleton stays system-owned
      expect(prompt).toContain('Return ONLY valid JSON with this structure:');
      expect(prompt).toContain('PROPOSAL WRITING BEST PRACTICES');
      expect(prompt).toContain('CONTEXT USAGE INSTRUCTIONS');
      expect(prompt).toContain('DOCUMENT TYPE: Cost Proposal');
    });

    it('keeps the template scaffold section when both scaffold and override are provided', () => {
      const scaffold = '<h1>Template Title</h1>';
      const prompt = buildSystemPromptForDocumentType('COVER_LETTER', scaffold, GUIDANCE_OVERRIDE);

      expect(prompt).toContain(GUIDANCE_OVERRIDE);
      expect(prompt).toContain('MANDATORY HTML TEMPLATE SCAFFOLD');
      expect(prompt).toContain(scaffold);
    });

    it('falls back to the type-specific default when the override is null or undefined', () => {
      const defaultGuidance = getDefaultGuidance('COST_PROPOSAL');
      expect(buildSystemPromptForDocumentType('COST_PROPOSAL', null, null)).toContain(defaultGuidance);
      expect(buildSystemPromptForDocumentType('COST_PROPOSAL')).toContain(defaultGuidance);
    });

    it('falls back to generic DEFAULT_GUIDANCE for unknown types without an override', () => {
      const prompt = buildSystemPromptForDocumentType('MY_CUSTOM_TYPE', null, null);
      expect(prompt).toContain(getDefaultGuidance('MY_CUSTOM_TYPE'));
    });
  });

  describe('buildSectionSystemPrompt', () => {
    it('substitutes only the guidance fragment, keeping the section skeleton intact', () => {
      const prompt = buildSectionSystemPrompt('TECHNICAL_PROPOSAL', GUIDANCE_OVERRIDE);

      expect(prompt).toContain(GUIDANCE_OVERRIDE);
      expect(prompt).not.toContain(getDefaultGuidance('TECHNICAL_PROPOSAL'));
      // Skeleton stays system-owned
      expect(prompt).toContain('CRITICAL OUTPUT FORMAT:');
      expect(prompt).toContain('MANDATORY TEMPLATE PRESERVATION');
      expect(prompt).toContain('TOOL USAGE');
    });

    it('falls back to the default guidance without an override', () => {
      const prompt = buildSectionSystemPrompt('TECHNICAL_PROPOSAL');
      expect(prompt).toContain(getDefaultGuidance('TECHNICAL_PROPOSAL'));
    });
  });

  describe('buildUserPromptForDocumentType', () => {
    it('substitutes only the task fragment, keeping context sections intact', () => {
      const prompt = buildUserPromptForDocumentType('COST_PROPOSAL', {
        solicitation: 'solicitation text',
        qaText: 'qa text',
        enrichedKbText: 'kb text',
        taskOverride: TASK_OVERRIDE,
      });

      expect(prompt).toContain(TASK_OVERRIDE);
      expect(prompt).not.toContain(getDefaultTask('COST_PROPOSAL'));
      // Skeleton stays system-owned
      expect(prompt).toContain('SOLICITATION / RFP DOCUMENTS');
      expect(prompt).toContain('solicitation text');
      expect(prompt).toContain('QUESTIONS & ANSWERS');
      expect(prompt).toContain('qa text');
      expect(prompt).toContain('ENRICHMENT CONTEXT');
      expect(prompt).toContain('kb text');
    });

    it('falls back to the type-specific default task when the override is null', () => {
      const prompt = buildUserPromptForDocumentType('COST_PROPOSAL', {
        solicitation: 's',
        qaText: 'q',
        enrichedKbText: 'k',
        taskOverride: null,
      });
      expect(prompt).toContain(getDefaultTask('COST_PROPOSAL'));
    });

    it('falls back to generic DEFAULT_TASK for unknown types without an override', () => {
      const prompt = buildUserPromptForDocumentType('MY_CUSTOM_TYPE', {
        solicitation: 's',
        qaText: 'q',
        enrichedKbText: 'k',
      });
      expect(prompt).toContain('YOUR TASK — My Custom Type:');
    });
  });
});

describe('pricing document prompt rules (T1)', () => {
  const PRICING_TYPES = ['COST_PROPOSAL', 'PRICE_VOLUME'] as const;

  describe.each(PRICING_TYPES)('%s mandatory pricing rules (non-overridable)', (type) => {
    const assertSharedRulesPresent = (prompt: string) => {
      expect(prompt).toContain('MANDATORY PRICING RULES');
      expect(prompt).toContain('SOLUTION PLAN CONSISTENCY');
      expect(prompt).toContain('If an Approved Solution Plan is provided');
      expect(prompt).toContain('CLIN');
      expect(prompt).toContain('period of performance');
      expect(prompt).toContain('THIRD-PARTY PRICING');
      expect(prompt).toContain('vendor quote required');
      expect(prompt).toContain('ONE row per service');
      expect(prompt).toContain('INTERNAL RATES');
      expect(prompt).toContain('get_pricing_data');
      expect(prompt).toContain('PAGE LIMITS');
      expect(prompt).toContain('page limit');
      // Fix A: no variant may instruct citing source URLs in the document
      expect(prompt).not.toContain('MUST cite its source URL');
      expect(prompt).toContain('Do NOT include source URLs or retrieval dates in this document');
    };

    const assertPlanAbsentVariant = (prompt: string) => {
      assertSharedRulesPresent(prompt);
      expect(prompt).toContain('NEVER invent');
      expect(prompt).toContain('search_service_pricing');
    };

    const assertPlanPresentVariant = (prompt: string) => {
      assertSharedRulesPresent(prompt);
      expect(prompt).toContain('ONLY source of third-party prices');
      expect(prompt).toContain('VERBATIM');
      expect(prompt).toContain('vendor quote required — not in Approved Solution Plan');
      // The tool is withheld when a plan exists — the rules must not reference it
      expect(prompt).not.toContain('search_service_pricing');
    };

    it('appear in the default full-document system prompt (plan-absent variant)', () => {
      assertPlanAbsentVariant(buildSystemPromptForDocumentType(type));
    });

    it('switch to the plan-as-single-price-source variant when a plan exists (Fix A)', () => {
      assertPlanPresentVariant(buildSystemPromptForDocumentType(type, null, null, true));
      assertPlanPresentVariant(buildSectionSystemPrompt(type, null, true));
    });

    it('survive an org guidance override in the full-document system prompt', () => {
      const prompt = buildSystemPromptForDocumentType(type, null, 'ORG GUIDANCE OVERRIDE');
      expect(prompt).toContain('ORG GUIDANCE OVERRIDE');
      assertPlanAbsentVariant(prompt);
    });

    it('survive an org guidance override in the section system prompt', () => {
      const prompt = buildSectionSystemPrompt(type, 'ORG GUIDANCE OVERRIDE');
      expect(prompt).toContain('ORG GUIDANCE OVERRIDE');
      assertPlanAbsentVariant(prompt);
    });

    it('survive an org guidance override in the plan-present variant too', () => {
      const prompt = buildSystemPromptForDocumentType(type, null, 'ORG GUIDANCE OVERRIDE', true);
      expect(prompt).toContain('ORG GUIDANCE OVERRIDE');
      assertPlanPresentVariant(prompt);
    });

    it('are NOT part of the editable default guidance fragment', () => {
      const guidance = getDefaultGuidance(type);
      expect(guidance).not.toContain('MANDATORY PRICING RULES');
      expect(guidance).not.toContain('SOLUTION PLAN CONSISTENCY');
      expect(guidance).not.toContain('THIRD-PARTY PRICING');
    });

    it('keeps the Third-Party Services & Subscriptions subsection without a Source column (Fix A)', () => {
      const guidance = getDefaultGuidance(type);
      expect(guidance).toContain('Third-Party Services & Subscriptions');
      expect(guidance).toContain('Service | Tier/Plan | Unit Price | Billing Period | Quantity | Extended Price');
      expect(guidance).not.toContain('Source (URL + retrieval date)');
      expect(guidance).not.toContain('| Source');
      expect(guidance).toContain('Do NOT include source URLs, retrieval dates, or a pricing-sources footnote');
    });
  });

  it('non-pricing doc types do not receive the mandatory pricing rules block', () => {
    expect(buildSystemPromptForDocumentType('TECHNICAL_PROPOSAL')).not.toContain('MANDATORY PRICING RULES');
    expect(buildSectionSystemPrompt('TECHNICAL_PROPOSAL')).not.toContain('MANDATORY PRICING RULES');
  });

  describe.each(PRICING_TYPES)('%s task', (type) => {
    const task = getDefaultTask(type);

    it('directs the model to read the Approved Solution Plan first (conditionally)', () => {
      expect(task).toContain('If an APPROVED SOLUTION PLAN is provided');
      expect(task).toContain('read it FIRST');
    });

    it('directs ONE batched search_service_pricing call only when no plan is provided', () => {
      expect(task).toContain('search_service_pricing');
      expect(task).toContain('ONE batched');
      expect(task).toContain('vendor quote required');
      expect(task).toContain('copy each service\'s price data VERBATIM');
      expect(task).toContain('vendor quote required — not in Approved Solution Plan');
    });

    it('forbids printing source URLs or a sources footnote in the document (Fix A)', () => {
      expect(task).toContain('Do NOT include source URLs, retrieval dates, or a pricing-sources footnote');
      expect(task).not.toContain('cites its source URL');
    });

    it('keeps internal rates sourced from get_pricing_data with the RATE BASIS check', () => {
      expect(task).toContain('get_pricing_data');
      expect(task).toContain('RATE BASIS');
      expect(task).toContain('NEVER relabel onshore numbers as offshore');
    });

    it('directs cross-checking totals against the Solution Plan cost drivers', () => {
      expect(task).toContain('cost drivers');
    });

    it('directs respecting solicitation page limits', () => {
      expect(task).toContain('page limit');
    });
  });
});

describe('plan-governed cost schedule injection', () => {
  const PRICING_TYPES = ['COST_PROPOSAL', 'PRICE_VOLUME'] as const;

  const costSchedule: SolutionPlanCostSchedule = {
    currency: 'USD',
    items: [
      { label: 'Implementation', category: 'LABOR', amount: 34720, billing: 'ONE_TIME' },
      { label: 'Managed hosting', category: 'LABOR', amount: 400, billing: 'MONTHLY' },
    ],
    oneTimeTotal: 34720,
    ongoingAnnualTotal: 4800,
  };

  const baseContext = {
    solicitation: 's',
    qaText: 'q',
    enrichedKbText: 'k',
    solutionPlanText: 'Approved plan body',
  };

  describe.each(PRICING_TYPES)('%s user prompt', (type) => {
    it('renders the AUTHORITATIVE COST SCHEDULE block under the plan block when a schedule exists', () => {
      const prompt = buildUserPromptForDocumentType(type, {
        ...baseContext,
        solutionPlanCostSchedule: costSchedule,
      });
      expect(prompt).toContain('AUTHORITATIVE COST SCHEDULE (SOURCE OF TRUTH — COPY THESE NUMBERS EXACTLY)');
      expect(prompt).toContain('TOTAL ONE-TIME: $34,720.00');
      expect(prompt).toContain('TOTAL ONGOING (ANNUAL): $4,800.00');
      const planIdx = prompt.indexOf('APPROVED SOLUTION PLAN (SOURCE OF TRUTH)');
      const scheduleIdx = prompt.indexOf('AUTHORITATIVE COST SCHEDULE');
      const kbIdx = prompt.indexOf('ENRICHMENT CONTEXT');
      expect(scheduleIdx).toBeGreaterThan(planIdx);
      expect(kbIdx).toBeGreaterThan(scheduleIdx);
    });

    it('omits the block when the schedule is null or undefined (legacy / user-edited plan)', () => {
      for (const schedule of [null, undefined]) {
        const prompt = buildUserPromptForDocumentType(type, {
          ...baseContext,
          solutionPlanCostSchedule: schedule,
        });
        // The task text may still mention the block conditionally ("If the
        // context contains…") — only the rendered block header must be absent.
        expect(prompt).not.toContain('AUTHORITATIVE COST SCHEDULE (SOURCE OF TRUTH');
      }
    });
  });

  it('never renders the schedule block for non-pricing document types', () => {
    const prompt = buildUserPromptForDocumentType('TECHNICAL_PROPOSAL', {
      ...baseContext,
      solutionPlanCostSchedule: costSchedule,
    });
    expect(prompt).not.toContain('AUTHORITATIVE COST SCHEDULE (SOURCE OF TRUTH');
  });

  describe.each(PRICING_TYPES)('%s PLAN-GOVERNED COSTS rules', (type) => {
    it('appear in the plan-present variant of the mandatory pricing rules', () => {
      for (const prompt of [
        buildSystemPromptForDocumentType(type, null, null, true),
        buildSectionSystemPrompt(type, null, true),
      ]) {
        expect(prompt).toContain('PLAN-GOVERNED COSTS');
        expect(prompt).toContain('labor-based own services (hosting, maintenance, support)');
        expect(prompt).toContain('(a) a schedule item amount copied verbatim');
        expect(prompt).toContain('MUST equal the schedule\'s TOTAL lines exactly');
      }
    });

    it('are absent from the plan-less variant', () => {
      expect(buildSystemPromptForDocumentType(type)).not.toContain('PLAN-GOVERNED COSTS');
      expect(buildSectionSystemPrompt(type)).not.toContain('PLAN-GOVERNED COSTS');
    });

    it('directs the task to the AUTHORITATIVE COST SCHEDULE block', () => {
      expect(getDefaultTask(type)).toContain('AUTHORITATIVE COST SCHEDULE');
    });

    it('pins multi-year derivation to exact schedule arithmetic (D3b)', () => {
      for (const prompt of [
        buildSystemPromptForDocumentType(type, null, null, true),
        buildSectionSystemPrompt(type, null, true),
      ]) {
        expect(prompt).toContain('Multi-year figures are exact arithmetic from the schedule');
        expect(prompt).toContain('unless the RFP mandates escalation');
      }
      expect(getDefaultTask(type)).toContain('Derive multi-year tables with exact arithmetic from the schedule');
    });
  });

  describe('buildPricingRulesBlock (exported for section edits)', () => {
    it('returns the mandatory rules for pricing types and an empty string otherwise', () => {
      expect(buildPricingRulesBlock('COST_PROPOSAL', true)).toContain('MANDATORY PRICING RULES');
      expect(buildPricingRulesBlock('COST_PROPOSAL', true)).toContain('PLAN-GOVERNED COSTS');
      expect(buildPricingRulesBlock('COST_PROPOSAL', false)).not.toContain('PLAN-GOVERNED COSTS');
      expect(buildPricingRulesBlock('TECHNICAL_PROPOSAL', true)).toBe('');
    });
  });
});

describe('Approved Solution Plan injection (ADR-7)', () => {
  const PLAN_TEXT = 'Architecture: three-tier serverless. Team: 4 engineers over 12 months.';

  describe('buildUserPromptForDocumentType', () => {
    it('inserts the SOURCE OF TRUTH block between Q&A and enrichment when plan text is provided', () => {
      const prompt = buildUserPromptForDocumentType('TECHNICAL_PROPOSAL', {
        solicitation: 'solicitation text',
        qaText: 'qa text',
        enrichedKbText: 'kb text',
        solutionPlanText: PLAN_TEXT,
      });

      expect(prompt).toContain('APPROVED SOLUTION PLAN (SOURCE OF TRUTH)');
      expect(prompt).toContain('OVERRIDES anything');
      expect(prompt).toContain(PLAN_TEXT);
      // Ordering: Q&A → solution plan → enrichment
      const qaIdx = prompt.indexOf('QUESTIONS & ANSWERS');
      const planIdx = prompt.indexOf('APPROVED SOLUTION PLAN (SOURCE OF TRUTH)');
      const kbIdx = prompt.indexOf('ENRICHMENT CONTEXT');
      expect(qaIdx).toBeGreaterThanOrEqual(0);
      expect(planIdx).toBeGreaterThan(qaIdx);
      expect(kbIdx).toBeGreaterThan(planIdx);
    });

    it('omits the block when plan text is absent, null, or blank', () => {
      for (const planText of [undefined, null, '', '   ']) {
        const prompt = buildUserPromptForDocumentType('TECHNICAL_PROPOSAL', {
          solicitation: 's',
          qaText: 'q',
          enrichedKbText: 'k',
          solutionPlanText: planText,
        });
        expect(prompt).not.toContain('APPROVED SOLUTION PLAN (SOURCE OF TRUTH)');
      }
    });

    it('keeps the block when a task override is also supplied', () => {
      const prompt = buildUserPromptForDocumentType('COST_PROPOSAL', {
        solicitation: 's',
        qaText: 'q',
        enrichedKbText: 'k',
        taskOverride: 'CUSTOM TASK',
        solutionPlanText: PLAN_TEXT,
      });
      expect(prompt).toContain('APPROVED SOLUTION PLAN (SOURCE OF TRUTH)');
      expect(prompt).toContain('CUSTOM TASK');
    });
  });

  describe('buildSystemPromptForDocumentType', () => {
    it('always carries the solution-plan context-usage instruction', () => {
      const prompt = buildSystemPromptForDocumentType('TECHNICAL_PROPOSAL');
      expect(prompt).toContain('APPROVED SOLUTION PLAN (when present)');
      expect(prompt).toContain('single source of truth');
    });

    it('keeps the instruction even when org guidance is overridden (non-overridable)', () => {
      const prompt = buildSystemPromptForDocumentType('TECHNICAL_PROPOSAL', null, 'ORG GUIDANCE OVERRIDE');
      expect(prompt).toContain('APPROVED SOLUTION PLAN (when present)');
    });
  });
});

describe('Saved Team injection (team-definition U4, BR2.1/BR2.4)', () => {
  const TEAM_TEXT = 'SAVED TEAM ROSTER (opportunity opp-1)\n1. Jane Doe — Project Manager';
  const baseContext = { solicitation: 's', qaText: 'q', enrichedKbText: 'k' };

  it('renders the SAVED TEAM source-of-truth block between Q&A and enrichment when teamContext is present', () => {
    const prompt = buildUserPromptForDocumentType('TEAM_QUALIFICATIONS', {
      ...baseContext,
      teamContext: TEAM_TEXT,
    });

    expect(prompt).toContain('SAVED TEAM (SOURCE OF TRUTH FOR PERSONNEL)');
    expect(prompt).toContain('EXCLUSIVE source for all personnel content');
    expect(prompt).toContain('NEVER invent, rename, or add');
    expect(prompt).toContain(TEAM_TEXT);
    const qaIdx = prompt.indexOf('QUESTIONS & ANSWERS');
    const teamIdx = prompt.indexOf('SAVED TEAM (SOURCE OF TRUTH FOR PERSONNEL)');
    const kbIdx = prompt.indexOf('ENRICHMENT CONTEXT');
    expect(teamIdx).toBeGreaterThan(qaIdx);
    expect(kbIdx).toBeGreaterThan(teamIdx);
  });

  it('omits the block when teamContext is absent, null, or blank', () => {
    for (const teamContext of [undefined, null, '', '   ']) {
      const prompt = buildUserPromptForDocumentType('TEAM_QUALIFICATIONS', {
        ...baseContext,
        teamContext,
      });
      expect(prompt).not.toContain('SAVED TEAM (SOURCE OF TRUTH FOR PERSONNEL)');
    }
  });

  it('renders after the solution-plan block when both are present', () => {
    const prompt = buildUserPromptForDocumentType('TEAM_QUALIFICATIONS', {
      ...baseContext,
      solutionPlanText: 'Approved plan body',
      teamContext: TEAM_TEXT,
    });
    const planIdx = prompt.indexOf('APPROVED SOLUTION PLAN (SOURCE OF TRUTH)');
    const teamIdx = prompt.indexOf('SAVED TEAM (SOURCE OF TRUTH FOR PERSONNEL)');
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(teamIdx).toBeGreaterThan(planIdx);
  });

  it('directs the TEAM_QUALIFICATIONS task to the SAVED TEAM block instead of KB personnel data', () => {
    const task = getDefaultTask('TEAM_QUALIFICATIONS');
    expect(task).toContain('SAVED TEAM block');
    expect(task).toContain('never from the Knowledge Base');
    expect(task).not.toContain('personnel data from the Knowledge Base');
  });
});
