import {
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
