import {
  buildSectionSystemPrompt,
  buildSystemPromptForDocumentType,
  buildUserPromptForDocumentType,
  getDefaultGuidance,
  getDefaultTask,
} from './document-prompts';
import { DocumentPromptTypeSchema } from '@auto-rfp/core';

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
    expect(guidance).toContain('get_pricing_data');
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
    const prompt = buildUserPromptForDocumentType('COST_PROPOSAL', 'solicitation', 'qa', 'kb');
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
      const prompt = buildUserPromptForDocumentType(
        'COST_PROPOSAL',
        'solicitation text',
        'qa text',
        'kb text',
        TASK_OVERRIDE,
      );

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
      const prompt = buildUserPromptForDocumentType('COST_PROPOSAL', 's', 'q', 'k', null);
      expect(prompt).toContain(getDefaultTask('COST_PROPOSAL'));
    });

    it('falls back to generic DEFAULT_TASK for unknown types without an override', () => {
      const prompt = buildUserPromptForDocumentType('MY_CUSTOM_TYPE', 's', 'q', 'k');
      expect(prompt).toContain('YOUR TASK — My Custom Type:');
    });
  });
});
