import { describe, it, expect } from 'vitest';
import {
  NotaryStatusSchema,
  NotaryCueSchema,
  NotarySourceSchema,
  NotaryTextSegmentSchema,
  NotaryCandidateSchema,
  NotaryRequirementSchema,
  NotarySummarySchema,
  statusSeverity,
} from './notary';

describe('NotaryStatusSchema', () => {
  it('accepts the three canonical statuses', () => {
    for (const s of ['REQUIRED', 'POSSIBLY_REQUIRED', 'NOT_REQUIRED']) {
      expect(NotaryStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(NotaryStatusSchema.safeParse('MAYBE').success).toBe(false);
  });
});

describe('statusSeverity — severity ordering (BR4.1)', () => {
  it('ranks REQUIRED > POSSIBLY_REQUIRED > NOT_REQUIRED', () => {
    expect(statusSeverity('REQUIRED')).toBe(3);
    expect(statusSeverity('POSSIBLY_REQUIRED')).toBe(2);
    expect(statusSeverity('NOT_REQUIRED')).toBe(1);
    // strict monotonicity — the property the max-severity merge relies on
    expect(statusSeverity('REQUIRED')).toBeGreaterThan(statusSeverity('POSSIBLY_REQUIRED'));
    expect(statusSeverity('POSSIBLY_REQUIRED')).toBeGreaterThan(statusSeverity('NOT_REQUIRED'));
  });
});

describe('NotaryCueSchema', () => {
  it('accepts every cue in the taxonomy', () => {
    for (const c of ['KEYWORD', 'ACK_BLOCK', 'STATE_COUNTY', 'COMMISSION', 'SWORN', 'WITNESS', 'INSTRUCTIONAL']) {
      expect(NotaryCueSchema.safeParse(c).success).toBe(true);
    }
  });

  it('rejects an unknown cue', () => {
    expect(NotaryCueSchema.safeParse('SIGNATURE').success).toBe(false);
  });
});

describe('NotarySourceSchema', () => {
  it('accepts the three provenance values', () => {
    for (const s of ['SOLICITATION_BODY', 'FORM_PAGE', 'FORM_FIELD']) {
      expect(NotarySourceSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an unknown source', () => {
    expect(NotarySourceSchema.safeParse('EMAIL_BODY').success).toBe(false);
  });
});

describe('NotaryTextSegmentSchema', () => {
  it('parses a minimal valid segment', () => {
    const { success, data } = NotaryTextSegmentSchema.safeParse({
      text: 'subscribed and sworn before me',
      source: 'FORM_PAGE',
      documentName: 'SF-1449.pdf',
      pageNumber: 2,
    });
    expect(success).toBe(true);
    expect(data?.pageNumber).toBe(2);
    // optional fields stay absent, not defaulted
    expect(data?.formId).toBeUndefined();
  });

  it('rejects empty text (BR1.1 recall input must have content)', () => {
    const { success, error } = NotaryTextSegmentSchema.safeParse({
      text: '',
      source: 'SOLICITATION_BODY',
      documentName: 'rfp.pdf',
    });
    expect(success).toBe(false);
    expect(error?.issues[0]?.path).toEqual(['text']);
  });

  it('rejects a non-positive / non-integer pageNumber', () => {
    expect(
      NotaryTextSegmentSchema.safeParse({ text: 't', source: 'FORM_PAGE', documentName: 'd', pageNumber: 0 }).success,
    ).toBe(false);
    expect(
      NotaryTextSegmentSchema.safeParse({ text: 't', source: 'FORM_PAGE', documentName: 'd', pageNumber: 1.5 }).success,
    ).toBe(false);
  });
});

describe('NotaryCandidateSchema', () => {
  it('parses a valid candidate with an offset', () => {
    const { success, data } = NotaryCandidateSchema.safeParse({
      source: 'SOLICITATION_BODY',
      cue: 'KEYWORD',
      triggeringText: '...notary public...',
      documentName: 'rfp.pdf',
      offset: 42,
    });
    expect(success).toBe(true);
    expect(data?.offset).toBe(42);
  });

  it('rejects a negative offset', () => {
    expect(
      NotaryCandidateSchema.safeParse({
        source: 'FORM_FIELD',
        cue: 'SWORN',
        triggeringText: 'x',
        documentName: 'd',
        offset: -1,
      }).success,
    ).toBe(false);
  });
});

describe('NotaryRequirementSchema', () => {
  it('defaults pageNumber to null when omitted (BR6.2)', () => {
    const { success, data } = NotaryRequirementSchema.safeParse({
      documentName: 'rfp.pdf',
      status: 'POSSIBLY_REQUIRED',
      cue: 'INSTRUCTIONAL',
      triggeringText: 'this form must be notarized',
    });
    expect(success).toBe(true);
    expect(data?.pageNumber).toBeNull();
    expect(data?.rationale).toBeUndefined();
  });

  it('accepts a positive pageNumber and a rationale', () => {
    const { success, data } = NotaryRequirementSchema.safeParse({
      formId: 'form-1',
      documentName: 'SF-1449.pdf',
      status: 'REQUIRED',
      cue: 'ACK_BLOCK',
      pageNumber: 3,
      triggeringText: 'acknowledged before me',
      rationale: 'bound acknowledgment block',
    });
    expect(success).toBe(true);
    expect(data?.pageNumber).toBe(3);
  });

  it('rejects an empty triggeringText (audit trail must carry evidence)', () => {
    expect(
      NotaryRequirementSchema.safeParse({
        documentName: 'd',
        status: 'REQUIRED',
        cue: 'KEYWORD',
        triggeringText: '',
      }).success,
    ).toBe(false);
  });
});

describe('NotarySummarySchema', () => {
  it('applies rollup defaults when nothing is provided', () => {
    const { success, data } = NotarySummarySchema.safeParse({});
    expect(success).toBe(true);
    expect(data).toEqual({
      anyNotaryRequired: false,
      requiredCount: 0,
      possiblyRequiredCount: 0,
      totalFormsConsidered: 0,
    });
  });

  it('rejects negative counts', () => {
    expect(NotarySummarySchema.safeParse({ requiredCount: -1 }).success).toBe(false);
  });
});
