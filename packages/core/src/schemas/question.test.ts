import { describe, it, expect } from 'vitest';
import {
  QuestionResponseKindSchema,
  QuestionOptionSchema,
  QuestionItemSchema,
  GroupedQuestionSchema,
  type QuestionResponseKind,
} from './question';

describe('QuestionResponseKindSchema', () => {
  it('accepts every valid response kind', () => {
    const kinds: QuestionResponseKind[] = ['TEXT', 'SINGLE_CHOICE', 'MULTI_CHOICE'];
    for (const kind of kinds) {
      expect(QuestionResponseKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    expect(QuestionResponseKindSchema.safeParse('DROPDOWN').success).toBe(false);
  });
});

describe('QuestionOptionSchema', () => {
  it('accepts a label-only option', () => {
    const { success, data } = QuestionOptionSchema.safeParse({ label: 'Yes' });
    expect(success).toBe(true);
    expect(data).toEqual({ label: 'Yes' });
  });

  it('accepts an option with an original marker value', () => {
    const { success } = QuestionOptionSchema.safeParse({ label: 'AWS', value: 'A' });
    expect(success).toBe(true);
  });

  it('rejects an empty label', () => {
    expect(QuestionOptionSchema.safeParse({ label: '' }).success).toBe(false);
  });
});

describe('QuestionItemSchema multiple-choice fields', () => {
  const base = {
    questionId: 'a'.repeat(64), // sha256 hex — must NOT be constrained to uuid
    sectionId: '00000000-0000-0000-0000-000000000000',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };

  it('accepts a sha256-hex questionId (not a uuid)', () => {
    const { success } = QuestionItemSchema.safeParse(base);
    expect(success).toBe(true);
  });

  it('accepts a single-choice question with options', () => {
    const { success, data } = QuestionItemSchema.safeParse({
      ...base,
      question: 'Which cloud provider?',
      responseKind: 'SINGLE_CHOICE',
      options: [{ label: 'AWS', value: 'A' }, { label: 'Azure', value: 'B' }],
    });
    expect(success).toBe(true);
    expect(data?.responseKind).toBe('SINGLE_CHOICE');
    expect(data?.options).toHaveLength(2);
  });

  it('treats responseKind and options as optional (legacy free-text rows)', () => {
    const { success, data } = QuestionItemSchema.safeParse({ ...base, question: 'Describe your approach.' });
    expect(success).toBe(true);
    expect(data?.responseKind).toBeUndefined();
    expect(data?.options).toBeUndefined();
  });
});

describe('GroupedQuestionSchema multiple-choice fields', () => {
  it('surfaces responseKind + options to the UI shape', () => {
    const { success, data } = GroupedQuestionSchema.safeParse({
      id: 'q1',
      question: 'Which certifications does your team hold?',
      answer: null,
      responseKind: 'MULTI_CHOICE',
      options: [{ label: 'CISSP' }, { label: 'PMP' }],
    });
    expect(success).toBe(true);
    expect(data?.responseKind).toBe('MULTI_CHOICE');
    expect(data?.options).toEqual([{ label: 'CISSP' }, { label: 'PMP' }]);
  });

  it('accepts a free-text grouped question without choice fields', () => {
    const { success } = GroupedQuestionSchema.safeParse({
      id: 'q2',
      question: 'Describe your approach.',
      answer: 'Some answer',
    });
    expect(success).toBe(true);
  });
});
