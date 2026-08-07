import { describe, it, expect } from 'vitest';
import {
  DocxFillStrategySchema,
  DocxAnchorSchema,
  DetectedFormFieldSchema,
  RequiredFormItemSchema,
  UpdateRequiredFormDTOSchema,
} from './required-form';

const validFormItem = {
  formId: 'form-123',
  orgId: 'org-123',
  projectId: 'proj-456',
  opportunityId: 'opp-789',
  name: 'Data Security Addendum',
  formType: 'DOCX_FORM' as const,
  status: 'READY' as const,
  sourceFileName: 'addendum.docx',
  sourceFileKey: 'org-123/proj-456/opp-789/required-forms/f/addendum.docx',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

describe('DocxFillStrategySchema', () => {
  it('accepts IN_PLACE and TEXT_TOKEN', () => {
    expect(DocxFillStrategySchema.safeParse('IN_PLACE').success).toBe(true);
    expect(DocxFillStrategySchema.safeParse('TEXT_TOKEN').success).toBe(true);
  });

  it('rejects unknown strategies', () => {
    expect(DocxFillStrategySchema.safeParse('OTHER').success).toBe(false);
    expect(DocxFillStrategySchema.safeParse('COMPANION').success).toBe(false);
  });
});

describe('DocxAnchorSchema', () => {
  it('parses an SDT anchor and defaults sourceLabel to null', () => {
    const { success, data } = DocxAnchorSchema.safeParse({ kind: 'SDT', ref: '-2048901239' });
    expect(success).toBe(true);
    expect(data?.sourceLabel).toBeNull();
  });

  it('parses a legacy form-field anchor with a label', () => {
    const { success, data } = DocxAnchorSchema.safeParse({
      kind: 'LEGACY_FORMFIELD',
      ref: 'CompanyName',
      sourceLabel: 'Company Name',
    });
    expect(success).toBe(true);
    expect(data?.sourceLabel).toBe('Company Name');
  });

  it('parses a TEXT_TOKEN anchor and defaults occurrence to null', () => {
    const { success, data } = DocxAnchorSchema.safeParse({ kind: 'TEXT_TOKEN', ref: '[INSERT SUPPLIER NAME]' });
    expect(success).toBe(true);
    expect(data?.occurrence).toBeNull();
  });

  it('parses a TEXT_LABEL anchor with a per-occurrence index', () => {
    const { success, data } = DocxAnchorSchema.safeParse({
      kind: 'TEXT_LABEL',
      ref: 'Name:',
      occurrence: 1,
      sourceLabel: 'Supplier — Name:',
    });
    expect(success).toBe(true);
    expect(data?.occurrence).toBe(1);
    expect(data?.sourceLabel).toBe('Supplier — Name:');
  });

  it('rejects a negative or non-integer occurrence', () => {
    expect(DocxAnchorSchema.safeParse({ kind: 'TEXT_LABEL', ref: 'Name:', occurrence: -1 }).success).toBe(false);
    expect(DocxAnchorSchema.safeParse({ kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 1.5 }).success).toBe(false);
  });

  it('rejects an unknown anchor kind', () => {
    expect(DocxAnchorSchema.safeParse({ kind: 'BOOKMARK', ref: 'x' }).success).toBe(false);
  });
});

describe('DetectedFormFieldSchema — docxAnchor', () => {
  it('defaults docxAnchor to null (back-compat with PDF/XLSX fields)', () => {
    const { success, data } = DetectedFormFieldSchema.safeParse({
      fieldId: 'fld-1',
      label: 'Company Name',
    });
    expect(success).toBe(true);
    expect(data?.docxAnchor).toBeNull();
  });

  it('accepts a populated docxAnchor', () => {
    const { success, data } = DetectedFormFieldSchema.safeParse({
      fieldId: 'fld-1',
      label: 'Company Name',
      docxAnchor: { kind: 'SDT', ref: '123', sourceLabel: 'Company Name' },
    });
    expect(success).toBe(true);
    expect(data?.docxAnchor?.ref).toBe('123');
  });
});

describe('RequiredFormItemSchema — docxFillStrategy', () => {
  it('defaults docxFillStrategy to null on legacy records', () => {
    const { success, data } = RequiredFormItemSchema.safeParse(validFormItem);
    expect(success).toBe(true);
    expect(data?.docxFillStrategy).toBeNull();
  });

  it('accepts an explicit fill strategy', () => {
    const { success, data } = RequiredFormItemSchema.safeParse({
      ...validFormItem,
      docxFillStrategy: 'TEXT_TOKEN',
    });
    expect(success).toBe(true);
    expect(data?.docxFillStrategy).toBe('TEXT_TOKEN');
  });
});

describe('UpdateRequiredFormDTOSchema — docxFillStrategy', () => {
  it('allows patching docxFillStrategy', () => {
    const { success, data } = UpdateRequiredFormDTOSchema.safeParse({ docxFillStrategy: 'IN_PLACE' });
    expect(success).toBe(true);
    expect(data?.docxFillStrategy).toBe('IN_PLACE');
  });

  it('allows omitting docxFillStrategy', () => {
    expect(UpdateRequiredFormDTOSchema.safeParse({ status: 'READY' }).success).toBe(true);
  });
});
