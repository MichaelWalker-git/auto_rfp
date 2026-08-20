import { describe, it, expect } from 'vitest';
import {
  RequiredFormVersionSchema,
  RequiredFormVersionSourceSchema,
  RequiredFormVersionListResponseSchema,
  RevertFormVersionRequestSchema,
} from './required-form-version';

const validVersion = {
  versionId: 'v1',
  formId: 'form-1',
  orgId: 'o',
  projectId: 'p',
  opportunityId: 'opp',
  versionNumber: 1,
  fields: [],
  createdAt: '2026-08-10T00:00:00.000Z',
};

describe('RequiredFormVersionSchema', () => {
  it('parses a valid version and defaults source to MANUAL', () => {
    const { success, data } = RequiredFormVersionSchema.safeParse(validVersion);
    expect(success).toBe(true);
    expect(data?.source).toBe('MANUAL');
  });

  it('rejects versionNumber < 1', () => {
    expect(RequiredFormVersionSchema.safeParse({ ...validVersion, versionNumber: 0 }).success).toBe(false);
  });

  it('accepts each source value', () => {
    for (const source of ['MANUAL', 'AI_MASS_EDIT', 'AI_FILL', 'SYSTEM']) {
      expect(RequiredFormVersionSchema.safeParse({ ...validVersion, source }).success).toBe(true);
    }
    expect(RequiredFormVersionSourceSchema.safeParse('OTHER').success).toBe(false);
  });

  it('caps changeNote at 500 chars', () => {
    expect(
      RequiredFormVersionSchema.safeParse({ ...validVersion, changeNote: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('RequiredFormVersionListResponseSchema', () => {
  it('parses a list envelope', () => {
    const { success } = RequiredFormVersionListResponseSchema.safeParse({
      versions: [validVersion],
      count: 1,
    });
    expect(success).toBe(true);
  });
});

describe('RevertFormVersionRequestSchema', () => {
  it('requires targetVersion >= 1', () => {
    expect(
      RevertFormVersionRequestSchema.safeParse({ formId: 'f', projectId: 'p', opportunityId: 'o', targetVersion: 0 })
        .success,
    ).toBe(false);
    expect(
      RevertFormVersionRequestSchema.safeParse({ formId: 'f', projectId: 'p', opportunityId: 'o', targetVersion: 2 })
        .success,
    ).toBe(true);
  });
});
