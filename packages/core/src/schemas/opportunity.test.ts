import { describe, it, expect } from 'vitest';
import {
  OpportunityItemSchema,
  OpportunityListItemSchema,
  OpportunityUpdateRequestSchema,
} from './opportunity';

const validOpportunity = {
  source: 'SAM_GOV' as const,
  id: 'opp-1',
  title: 'Test Solicitation',
  type: null,
  postedDateIso: null,
  responseDeadlineIso: null,
  noticeId: null,
  solicitationNumber: null,
  naicsCode: null,
  pscCode: null,
  organizationName: null,
  setAside: null,
  description: null,
  baseAndAllOptionsValue: null,
};

const validSummary = {
  anyNotaryRequired: true,
  requiredCount: 1,
  possiblyRequiredCount: 2,
  totalFormsConsidered: 6,
  computedAt: '2026-08-25T00:00:00Z',
};

describe('OpportunityItemSchema — notary rollup (u2)', () => {
  it('parses legacy records with the notary fields absent (nullish, no default)', () => {
    const { success, data } = OpportunityItemSchema.safeParse(validOpportunity);
    expect(success).toBe(true);
    // .nullish() (like the sibling deliveryConstraintSource) — absent, not defaulted,
    // so no migration is forced onto existing records/construction sites.
    expect(data?.notarySummary ?? null).toBeNull();
    expect(data?.notarySummarySource ?? null).toBeNull();
  });

  it('accepts a populated notarySummary + USER_SET source', () => {
    const { success, data } = OpportunityItemSchema.safeParse({
      ...validOpportunity,
      notarySummary: validSummary,
      notarySummarySource: 'USER_SET',
    });
    expect(success).toBe(true);
    expect(data?.notarySummary?.requiredCount).toBe(1);
    expect(data?.notarySummary?.possiblyRequiredCount).toBe(2);
    expect(data?.notarySummarySource).toBe('USER_SET');
  });

  it('rejects an invalid notarySummarySource', () => {
    expect(
      OpportunityItemSchema.safeParse({ ...validOpportunity, notarySummarySource: 'NOPE' }).success,
    ).toBe(false);
  });

  it('accepts a populated notaryUnmappedTriggers array (opportunity-level evidence store)', () => {
    const { success, data } = OpportunityItemSchema.safeParse({
      ...validOpportunity,
      notaryUnmappedTriggers: [
        {
          documentName: 'solicitation.pdf',
          status: 'POSSIBLY_REQUIRED',
          cue: 'KEYWORD',
          pageNumber: null,
          triggeringText: 'all certifications must be notarized',
        },
      ],
    });
    expect(success).toBe(true);
    expect(data?.notaryUnmappedTriggers).toHaveLength(1);
    expect(data?.notaryUnmappedTriggers?.[0].status).toBe('POSSIBLY_REQUIRED');
  });

  it('leaves notaryUnmappedTriggers absent (nullish, no default) on legacy records', () => {
    const { success, data } = OpportunityItemSchema.safeParse(validOpportunity);
    expect(success).toBe(true);
    expect(data?.notaryUnmappedTriggers ?? null).toBeNull();
  });
});

describe('OpportunityListItemSchema — notarySummary mirror (u2)', () => {
  it('defaults notarySummary to null so the card badge reads it cleanly', () => {
    const { success, data } = OpportunityListItemSchema.safeParse({
      id: 'opp-1',
      source: 'SAM_GOV',
      title: 'Test',
    });
    expect(success).toBe(true);
    expect(data?.notarySummary).toBeNull();
  });

  it('carries the mirrored notarySummary when present', () => {
    const { success, data } = OpportunityListItemSchema.safeParse({
      id: 'opp-1',
      source: 'SAM_GOV',
      title: 'Test',
      notarySummary: validSummary,
    });
    expect(success).toBe(true);
    expect(data?.notarySummary?.anyNotaryRequired).toBe(true);
  });
});

describe('OpportunityUpdateRequestSchema — notary patch (u2 / WF-E)', () => {
  it('permits patching notarySummary + notarySummarySource (user override)', () => {
    const { success, data } = OpportunityUpdateRequestSchema.safeParse({
      notarySummary: { ...validSummary, anyNotaryRequired: false, requiredCount: 0, possiblyRequiredCount: 0 },
      notarySummarySource: 'USER_SET',
    });
    expect(success).toBe(true);
    expect(data?.notarySummarySource).toBe('USER_SET');
  });

  it('permits an empty patch (all fields optional)', () => {
    expect(OpportunityUpdateRequestSchema.safeParse({}).success).toBe(true);
  });

  it('permits patching notaryUnmappedTriggers (opportunity-level evidence store)', () => {
    const { success, data } = OpportunityUpdateRequestSchema.safeParse({
      notaryUnmappedTriggers: [
        {
          documentName: 'solicitation.pdf',
          status: 'REQUIRED',
          cue: 'ACK_BLOCK',
          pageNumber: null,
          triggeringText: 'notarized acknowledgment required',
        },
      ],
    });
    expect(success).toBe(true);
    expect(data?.notaryUnmappedTriggers).toHaveLength(1);
  });
});
