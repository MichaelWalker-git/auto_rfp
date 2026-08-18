import { describe, it, expect } from 'vitest';
import {
  DisclosureLevelSchema,
  DISCLOSURE_ORDER,
  PastProjectSchema,
  CreatePastProjectDTOSchema,
  UpdatePastProjectDTOSchema,
  ClassifyDisclosureRequestSchema,
  ConfirmDisclosureRequestSchema,
  ExtractedDisclosureSchema,
  type DisclosureLevel,
} from './past-performance';

const baseProject = {
  projectId: '11111111-1111-1111-1111-111111111111',
  orgId: '22222222-2222-2222-2222-222222222222',
  title: 'Sample project',
  client: 'Acme Corp',
  description: 'A sufficiently long description.',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  createdBy: '33333333-3333-3333-3333-333333333333',
};

describe('DisclosureLevelSchema', () => {
  it('accepts all valid levels', () => {
    const levels: DisclosureLevel[] = [
      'NAMEABLE',
      'ANONYMIZED_ONLY',
      'PERMISSION_REQUIRED',
      'DO_NOT_USE',
    ];
    levels.forEach((level) => {
      expect(DisclosureLevelSchema.safeParse(level).success).toBe(true);
    });
  });

  it('rejects unknown levels', () => {
    expect(DisclosureLevelSchema.safeParse('MAYBE').success).toBe(false);
  });

  it('orders severity ascending from NAMEABLE to DO_NOT_USE', () => {
    expect(DISCLOSURE_ORDER.NAMEABLE).toBeLessThan(DISCLOSURE_ORDER.ANONYMIZED_ONLY);
    expect(DISCLOSURE_ORDER.ANONYMIZED_ONLY).toBeLessThan(DISCLOSURE_ORDER.PERMISSION_REQUIRED);
    expect(DISCLOSURE_ORDER.PERMISSION_REQUIRED).toBeLessThan(DISCLOSURE_ORDER.DO_NOT_USE);
  });
});

describe('PastProjectSchema disclosure defaults (fail-closed)', () => {
  it('defaults disclosure to PERMISSION_REQUIRED when omitted', () => {
    const parsed = PastProjectSchema.parse(baseProject);
    expect(parsed.disclosure).toBe('PERMISSION_REQUIRED');
  });

  it('defaults disclosureConfirmed to false when omitted', () => {
    const parsed = PastProjectSchema.parse(baseProject);
    expect(parsed.disclosureConfirmed).toBe(false);
  });

  it('defaults disclosureSignals to an empty array', () => {
    const parsed = PastProjectSchema.parse(baseProject);
    expect(parsed.disclosureSignals).toEqual([]);
  });

  it('preserves an explicitly-set NAMEABLE disclosure but keeps confirmation default false', () => {
    const parsed = PastProjectSchema.parse({ ...baseProject, disclosure: 'NAMEABLE' });
    expect(parsed.disclosure).toBe('NAMEABLE');
    expect(parsed.disclosureConfirmed).toBe(false);
  });
});

describe('CreatePastProjectDTOSchema', () => {
  it('allows an optional initial disclosure + note', () => {
    const parsed = CreatePastProjectDTOSchema.safeParse({
      orgId: baseProject.orgId,
      title: 'x',
      client: 'y',
      description: 'A sufficiently long description.',
      disclosure: 'ANONYMIZED_ONLY',
      disclosureContactNote: 'Client prefers anonymity.',
    });
    expect(parsed.success).toBe(true);
  });

  it('does not accept disclosureConfirmed (not part of the create DTO)', () => {
    const parsed = CreatePastProjectDTOSchema.parse({
      orgId: baseProject.orgId,
      title: 'x',
      client: 'y',
      description: 'A sufficiently long description.',
      disclosureConfirmed: true,
    });
    expect('disclosureConfirmed' in parsed).toBe(false);
  });
});

describe('UpdatePastProjectDTOSchema', () => {
  it('allows editing disclosure and a nullable note', () => {
    const parsed = UpdatePastProjectDTOSchema.safeParse({
      disclosure: 'DO_NOT_USE',
      disclosureContactNote: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('does not accept disclosureConfirmed (confirmation is review-only)', () => {
    const parsed = UpdatePastProjectDTOSchema.parse({ disclosureConfirmed: true });
    expect('disclosureConfirmed' in parsed).toBe(false);
  });
});

describe('ClassifyDisclosureRequestSchema', () => {
  it('defaults force to false and allows omitting projectIds', () => {
    const parsed = ClassifyDisclosureRequestSchema.parse({ orgId: baseProject.orgId });
    expect(parsed.force).toBe(false);
    expect(parsed.projectIds).toBeUndefined();
  });
});

describe('ConfirmDisclosureRequestSchema', () => {
  it('requires at least one row', () => {
    const parsed = ConfirmDisclosureRequestSchema.safeParse({ orgId: baseProject.orgId, rows: [] });
    expect(parsed.success).toBe(false);
  });

  it('accepts a valid row batch', () => {
    const parsed = ConfirmDisclosureRequestSchema.safeParse({
      orgId: baseProject.orgId,
      rows: [{ projectId: baseProject.projectId, disclosure: 'NAMEABLE' }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('ExtractedDisclosureSchema', () => {
  it('requires a non-empty rationale and defaults signals', () => {
    const parsed = ExtractedDisclosureSchema.safeParse({
      proposed: 'PERMISSION_REQUIRED',
      rationale: 'Ambiguous evidence.',
      confidence: 40,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.signals).toEqual([]);
  });

  it('rejects an empty rationale', () => {
    const parsed = ExtractedDisclosureSchema.safeParse({
      proposed: 'NAMEABLE',
      rationale: '',
      confidence: 90,
    });
    expect(parsed.success).toBe(false);
  });
});
