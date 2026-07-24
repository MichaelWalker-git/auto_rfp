import * as XLSX from 'xlsx';

const mockSend = jest.fn();
const mockUpload = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  GetObjectCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

jest.mock('./s3', () => ({
  uploadToS3: (...args: unknown[]) => mockUpload(...args),
}));

process.env.DOCUMENTS_BUCKET = 'docs-bucket';

import { fillXlsxForm } from './xlsx-form-filler';
import type { DetectedFormField } from '@auto-rfp/core';

const sheetToBytes = (rows: (string | number | null)[][]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

const multiSheetToBytes = (sheets: { name: string; rows: (string | number | null)[][] }[]) => {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

const mockSourceFile = (rows: (string | number | null)[][]) => {
  const bytes = sheetToBytes(rows);
  mockSend.mockResolvedValueOnce({
    Body: { transformToByteArray: async () => bytes },
  });
};

const mockMultiSheetSource = (sheets: { name: string; rows: (string | number | null)[][] }[]) => {
  const bytes = multiSheetToBytes(sheets);
  mockSend.mockResolvedValueOnce({
    Body: { transformToByteArray: async () => bytes },
  });
};

const readUploadedWorkbook = (): XLSX.WorkBook => {
  const buf = mockUpload.mock.calls[0][2] as Buffer;
  return XLSX.read(buf, { type: 'buffer' });
};

const buildField = (overrides: Partial<DetectedFormField>): DetectedFormField => ({
  fieldId: 'f1',
  label: 'Test',
  value: null,
  status: 'EMPTY',
  confidence: null,
  profileFieldKey: null,
  manualReason: null,
  pageNumber: null,
  cellReference: 'A1',
  sheetName: null,
  sheetIndex: null,
  boundingBox: null,
  markType: 'TEXT',
  markChar: null,
  markGeometry: null,
  matrixCategory: null,
  matrixFeature: null,
  matrixColumn: 'OTHER',
  ...overrides,
});

const readUploadedSheet = (): XLSX.WorkSheet => {
  const buf = mockUpload.mock.calls[0][2] as Buffer;
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return sheet;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fillXlsxForm', () => {
  it('writes text values into the referenced cells', async () => {
    mockSourceFile([['', '', ''], ['', '', '']]);
    const fields = [buildField({ cellReference: 'B1', value: 'hello', markType: 'TEXT' })];
    await fillXlsxForm({ sourceFileKey: 'src', fields, outputKey: 'out' });

    const sheet = readUploadedSheet();
    expect(sheet['B1']?.v).toBe('hello');
  });

  it('writes the literal X for CHECKBOX fields when markChar is set', async () => {
    mockSourceFile([['Feature', 'Yes', 'No'], ['Audit', '', '']]);
    const fields = [buildField({
      cellReference: 'B2', markType: 'CHECKBOX', markChar: 'X',
    })];
    await fillXlsxForm({ sourceFileKey: 'src', fields, outputKey: 'out' });
    const sheet = readUploadedSheet();
    expect(sheet['B2']?.v).toBe('X');
  });

  it('writes ○ for CIRCLE fields with markChar', async () => {
    mockSourceFile([['Feature', 'Choice'], ['MFA', '']]);
    const fields = [buildField({
      cellReference: 'B2', markType: 'CIRCLE', markChar: '○',
    })];
    await fillXlsxForm({ sourceFileKey: 'src', fields, outputKey: 'out' });
    const sheet = readUploadedSheet();
    expect(sheet['B2']?.v).toBe('○');
  });

  it('skips fields with no value and no markChar — original cells unchanged', async () => {
    mockSourceFile([['hello', 'world']]);
    const fields = [buildField({ cellReference: 'B1', value: null, markChar: null })];
    await fillXlsxForm({ sourceFileKey: 'src', fields, outputKey: 'out' });
    const sheet = readUploadedSheet();
    // We don't overwrite — original cell value must remain.
    expect(sheet['B1']?.v).toBe('world');
    expect(sheet['A1']?.v).toBe('hello');
  });

  it('uploads with the xlsx mime type', async () => {
    mockSourceFile([['']]);
    await fillXlsxForm({
      sourceFileKey: 'src',
      fields: [buildField({ cellReference: 'A1', value: 'x' })],
      outputKey: 'out',
    });
    expect(mockUpload).toHaveBeenCalledWith(
      'docs-bucket',
      'out',
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('routes fields to the sheet named on the field, not just the first sheet', async () => {
    mockMultiSheetSource([
      { name: 'Instructions', rows: [['Read me first']] },
      { name: 'Compliance', rows: [['Feature', 'Fully Meets'], ['MFA', '']] },
    ]);
    const fields = [buildField({
      cellReference: 'B2', value: 'X', sheetName: 'Compliance', sheetIndex: 1,
    })];
    await fillXlsxForm({ sourceFileKey: 'src', fields, outputKey: 'out' });

    const wb = readUploadedWorkbook();
    expect(wb.Sheets['Compliance']?.['B2']?.v).toBe('X');
  });

  it('drops sheets that contain no fields from the exported workbook', async () => {
    mockMultiSheetSource([
      { name: 'Instructions', rows: [['Read me first']] },
      { name: 'Compliance', rows: [['Feature', 'Fully Meets'], ['MFA', '']] },
    ]);
    const fields = [buildField({
      cellReference: 'B2', value: 'X', sheetName: 'Compliance', sheetIndex: 1,
    })];
    await fillXlsxForm({ sourceFileKey: 'src', fields, outputKey: 'out' });

    const wb = readUploadedWorkbook();
    // Only the data sheet survives; the instructions tab is stripped.
    expect(wb.SheetNames).toEqual(['Compliance']);
  });

  it('falls back to the first sheet for legacy fields with no sheet identity', async () => {
    mockMultiSheetSource([
      { name: 'Data', rows: [['', '']] },
      { name: 'Other', rows: [['', '']] },
    ]);
    const fields = [buildField({ cellReference: 'A1', value: 'legacy', sheetName: null, sheetIndex: null })];
    await fillXlsxForm({ sourceFileKey: 'src', fields, outputKey: 'out' });

    const wb = readUploadedWorkbook();
    expect(wb.Sheets['Data']?.['A1']?.v).toBe('legacy');
    expect(wb.SheetNames).toEqual(['Data']);
  });
});
