import { describe, it, expect } from 'vitest';
import {
  EditTargetSchema,
  ProposedEditSchema,
  PackageEditRunSchema,
  PackageEditRunStatusSchema,
  PackageEditChatRequestSchema,
  PackageEditChatResponseSchema,
  ApplyEditsRequestSchema,
  EditApplyResultSchema,
  ApplyEditsResponseSchema,
  GetPackageEditRunResponseSchema,
} from './package-edit';

describe('EditTargetSchema (discriminated union)', () => {
  it('parses an RFP_DOCUMENT target with a heading anchor', () => {
    const { success, data } = EditTargetSchema.safeParse({
      kind: 'RFP_DOCUMENT',
      documentId: 'doc-1',
      documentTitle: 'Tech',
      anchor: { kind: 'heading', text: 'Cost' },
    });
    expect(success).toBe(true);
    if (data?.kind === 'RFP_DOCUMENT') expect(data.anchor?.kind).toBe('heading');
  });

  it('parses a FORM target', () => {
    const { success, data } = EditTargetSchema.safeParse({
      kind: 'FORM',
      formId: 'form-1',
      fieldId: 'fld-1',
      fieldLabel: 'Total',
    });
    expect(success).toBe(true);
    if (data?.kind === 'FORM') expect(data.fieldId).toBe('fld-1');
  });

  it('parses a QUESTIONNAIRE target with cell coordinates', () => {
    const { success, data } = EditTargetSchema.safeParse({
      kind: 'QUESTIONNAIRE',
      documentId: 'q-1',
      documentTitle: 'Security Questionnaire',
      sheetName: 'Sheet1',
      row: 4,
      col: 2,
      ref: 'C5',
    });
    expect(success).toBe(true);
    if (data?.kind === 'QUESTIONNAIRE') {
      expect(data.ref).toBe('C5');
      expect(data.row).toBe(4);
    }
  });

  it('rejects a QUESTIONNAIRE target with a negative row/col', () => {
    expect(
      EditTargetSchema.safeParse({
        kind: 'QUESTIONNAIRE',
        documentId: 'q-1',
        sheetName: 'Sheet1',
        row: -1,
        col: 0,
        ref: 'A1',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(EditTargetSchema.safeParse({ kind: 'SPREADSHEET', id: 'x' }).success).toBe(false);
  });

  it('rejects an RFP_DOCUMENT target missing documentId', () => {
    expect(EditTargetSchema.safeParse({ kind: 'RFP_DOCUMENT' }).success).toBe(false);
  });
});

describe('ProposedEditSchema', () => {
  it('defaults advisoryOnly to false', () => {
    const { success, data } = ProposedEditSchema.safeParse({
      editId: 'e1',
      target: { kind: 'FORM', formId: 'f', fieldId: 'fl' },
      before: 'a',
      after: 'b',
      rationale: 'why',
    });
    expect(success).toBe(true);
    expect(data?.advisoryOnly).toBe(false);
  });
});

describe('PackageEditRunSchema', () => {
  const base = {
    runId: 'r1',
    orgId: 'o',
    projectId: 'p',
    oppId: 'opp',
    status: 'PROPOSING' as const,
    instruction: 'make it $2.4M',
    startedAt: '2026-08-10T00:00:00.000Z',
  };

  it('applies defaults for proposals and snapshotVersionIds', () => {
    const { success, data } = PackageEditRunSchema.safeParse(base);
    expect(success).toBe(true);
    expect(data?.proposals).toEqual([]);
    expect(data?.snapshotVersionIds).toEqual({});
  });

  it('accepts each lifecycle status', () => {
    for (const status of ['PROPOSING', 'PROPOSED', 'FAILED']) {
      expect(PackageEditRunSchema.safeParse({ ...base, status }).success).toBe(true);
    }
    expect(PackageEditRunStatusSchema.safeParse('READY').success).toBe(false);
  });
});

describe('chat request/response', () => {
  it('rejects an empty message and one over 2000 chars', () => {
    expect(PackageEditChatRequestSchema.safeParse({ message: '' }).success).toBe(false);
    expect(PackageEditChatRequestSchema.safeParse({ message: 'x'.repeat(2001) }).success).toBe(false);
    expect(PackageEditChatRequestSchema.safeParse({ message: 'hi' }).success).toBe(true);
  });

  it('parses an EDIT response carrying a runId', () => {
    const { success, data } = PackageEditChatResponseSchema.safeParse({
      messageId: 'm1',
      answer: 'Analyzing…',
      intent: 'EDIT',
      runId: 'r1',
    });
    expect(success).toBe(true);
    expect(data?.intent).toBe('EDIT');
    expect(data?.runId).toBe('r1');
  });
});

describe('apply request/response', () => {
  it('requires at least one editId', () => {
    expect(ApplyEditsRequestSchema.safeParse({ runId: 'r', editIds: [] }).success).toBe(false);
    expect(ApplyEditsRequestSchema.safeParse({ runId: 'r', editIds: ['e1'] }).success).toBe(true);
  });

  it('validates the per-target result enum', () => {
    for (const status of ['applied', 'skipped-stale', 'failed']) {
      expect(EditApplyResultSchema.safeParse({ editId: 'e', status }).success).toBe(true);
    }
    expect(EditApplyResultSchema.safeParse({ editId: 'e', status: 'ok' }).success).toBe(false);
  });

  it('parses a results envelope', () => {
    const { success } = ApplyEditsResponseSchema.safeParse({
      results: [{ editId: 'e', status: 'applied', newVersionNumber: 3 }],
    });
    expect(success).toBe(true);
  });
});

describe('GetPackageEditRunResponseSchema', () => {
  it('allows a null run and defaults stale to false', () => {
    const { success, data } = GetPackageEditRunResponseSchema.safeParse({ run: null });
    expect(success).toBe(true);
    expect(data?.stale).toBe(false);
  });
});
