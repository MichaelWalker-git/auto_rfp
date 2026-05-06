import { describe, it, expect } from 'vitest';
import { OpportunityItemSchema } from './opportunity';

describe('OpportunityItemSchema — decision date fields', () => {
  const baseOpportunity = {
    source: 'MANUAL_UPLOAD' as const,
    id: 'opp-1',
    title: 'Test Opportunity',
    type: null,
    postedDateIso: '2026-01-01',
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

  it('accepts decisionDateIso as ISO date-only string', () => {
    const { success, data } = OpportunityItemSchema.safeParse({
      ...baseOpportunity,
      decisionDateIso: '2026-06-15',
    });
    expect(success).toBe(true);
    expect(data?.decisionDateIso).toBe('2026-06-15');
  });

  it('accepts decisionDateIso as ISO datetime with offset', () => {
    const { success, data } = OpportunityItemSchema.safeParse({
      ...baseOpportunity,
      decisionDateIso: '2026-06-15T14:00:00-05:00',
    });
    expect(success).toBe(true);
    expect(data?.decisionDateIso).toBe('2026-06-15T14:00:00-05:00');
  });

  it('accepts decisionDateIso as ISO datetime without offset', () => {
    const { success, data } = OpportunityItemSchema.safeParse({
      ...baseOpportunity,
      decisionDateIso: '2026-06-15T14:00:00Z',
    });
    expect(success).toBe(true);
    expect(data?.decisionDateIso).toBe('2026-06-15T14:00:00Z');
  });

  it('accepts contractStartDateIso as ISO date-only string', () => {
    const { success, data } = OpportunityItemSchema.safeParse({
      ...baseOpportunity,
      contractStartDateIso: '2026-09-01',
    });
    expect(success).toBe(true);
    expect(data?.contractStartDateIso).toBe('2026-09-01');
  });

  it('accepts both fields simultaneously', () => {
    const { success, data } = OpportunityItemSchema.safeParse({
      ...baseOpportunity,
      decisionDateIso: '2026-06-15',
      contractStartDateIso: '2026-09-01',
    });
    expect(success).toBe(true);
    expect(data?.decisionDateIso).toBe('2026-06-15');
    expect(data?.contractStartDateIso).toBe('2026-09-01');
  });

  it('accepts null for both fields', () => {
    const { success, data } = OpportunityItemSchema.safeParse({
      ...baseOpportunity,
      decisionDateIso: null,
      contractStartDateIso: null,
    });
    expect(success).toBe(true);
    expect(data?.decisionDateIso).toBeNull();
    expect(data?.contractStartDateIso).toBeNull();
  });

  it('accepts undefined (omitted) for both fields', () => {
    const { success, data } = OpportunityItemSchema.safeParse(baseOpportunity);
    expect(success).toBe(true);
    expect(data?.decisionDateIso).toBeUndefined();
    expect(data?.contractStartDateIso).toBeUndefined();
  });

  it('rejects invalid date format for decisionDateIso', () => {
    const { success } = OpportunityItemSchema.safeParse({
      ...baseOpportunity,
      decisionDateIso: 'not-a-date',
    });
    expect(success).toBe(false);
  });

  it('rejects invalid date format for contractStartDateIso', () => {
    const { success } = OpportunityItemSchema.safeParse({
      ...baseOpportunity,
      contractStartDateIso: '15/06/2026',
    });
    expect(success).toBe(false);
  });
});
