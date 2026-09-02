import { describe, it, expect } from 'vitest';

import {
  QuestionnaireVersionSchema,
  QuestionnaireVersionSourceSchema,
  QuestionnaireVersionListResponseSchema,
  RevertQuestionnaireVersionRequestSchema,
} from './questionnaire-version';

const validVersion = {
  versionId: 'v1',
  documentId: 'doc-1',
  orgId: 'o',
  projectId: 'p',
  opportunityId: 'opp',
  versionNumber: 1,
  snapshotFileKey: 'questionnaire-versions/doc-1/v1.xlsx',
  createdAt: '2026-08-13T00:00:00.000Z',
};

describe('QuestionnaireVersionSchema', () => {
  it('parses a valid version and defaults source to MANUAL', () => {
    const { success, data } = QuestionnaireVersionSchema.safeParse(validVersion);
    expect(success).toBe(true);
    expect(data?.source).toBe('MANUAL');
  });

  it('requires a snapshotFileKey', () => {
    const { snapshotFileKey, ...rest } = validVersion;
    expect(QuestionnaireVersionSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects versionNumber < 1', () => {
    expect(QuestionnaireVersionSchema.safeParse({ ...validVersion, versionNumber: 0 }).success).toBe(false);
  });

  it('accepts each source value and rejects unknown ones', () => {
    for (const source of ['MANUAL', 'AI_MASS_EDIT', 'SYSTEM']) {
      expect(QuestionnaireVersionSchema.safeParse({ ...validVersion, source }).success).toBe(true);
    }
    expect(QuestionnaireVersionSourceSchema.safeParse('AI_FILL').success).toBe(false);
  });

  it('caps changeNote at 500 chars', () => {
    expect(
      QuestionnaireVersionSchema.safeParse({ ...validVersion, changeNote: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('QuestionnaireVersionListResponseSchema', () => {
  it('parses a list envelope', () => {
    const { success } = QuestionnaireVersionListResponseSchema.safeParse({
      versions: [validVersion],
      count: 1,
    });
    expect(success).toBe(true);
  });
});

describe('RevertQuestionnaireVersionRequestSchema', () => {
  it('requires targetVersion >= 1', () => {
    expect(
      RevertQuestionnaireVersionRequestSchema.safeParse({
        documentId: 'd',
        projectId: 'p',
        opportunityId: 'o',
        targetVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      RevertQuestionnaireVersionRequestSchema.safeParse({
        documentId: 'd',
        projectId: 'p',
        opportunityId: 'o',
        targetVersion: 2,
      }).success,
    ).toBe(true);
  });
});
