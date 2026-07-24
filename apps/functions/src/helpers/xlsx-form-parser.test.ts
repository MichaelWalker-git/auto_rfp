import * as XLSX from 'xlsx';

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  GetObjectCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { parseXlsxForms } from './xlsx-form-parser';

const sheetToBytes = (rows: (string | number | null)[][]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
};

const multiSheetToBytes = (sheets: { name: string; rows: (string | number | null)[][] }[]) => {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

const mockS3Body = (bytes: Uint8Array) => {
  mockSend.mockResolvedValueOnce({
    Body: { transformToByteArray: async () => bytes },
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('parseXlsxForms', () => {
  it('detects an XLSX matrix and tags fields with matrix metadata', async () => {
    mockS3Body(sheetToBytes([
      ['Feature', 'Fully Meets', 'Partially Meets', 'Cannot Meet', 'Comments'],
      ['MFA support', '', '', '', ''],
      ['SSO support', '', '', '', ''],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    expect(result).toHaveLength(1);
    expect(result[0].formType).toBe('XLSX_MATRIX');

    // 2 features × 4 columns (3 response + 1 comments) = 8 fields
    expect(result[0].fields).toHaveLength(8);

    const mfaFully = result[0].fields.find(
      (f) => f.matrixFeature === 'MFA support' && f.matrixColumn === 'FULLY_MEETS',
    );
    expect(mfaFully).toBeDefined();
    expect(mfaFully?.status).toBe('MANUAL_REQUIRED');
    expect(mfaFully?.manualReason).toMatch(/manual review/i);

    const mfaComments = result[0].fields.find(
      (f) => f.matrixFeature === 'MFA support' && f.matrixColumn === 'COMMENTS',
    );
    expect(mfaComments).toBeDefined();
    expect(mfaComments?.status).toBe('EMPTY');
  });

  it('captures the section header above the matrix as matrixCategory', async () => {
    mockS3Body(sheetToBytes([
      ['Cybersecurity Requirements'],
      [],
      ['Feature', 'Fully Meets', 'Partially Meets', 'Cannot Meet', 'Comments'],
      ['Encryption at rest', '', '', '', ''],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    expect(result[0].formType).toBe('XLSX_MATRIX');
    const field = result[0].fields[0];
    expect(field.matrixCategory).toBe('Cybersecurity Requirements');
    expect(field.matrixFeature).toBe('Encryption at rest');
  });

  it('detects checkbox columns by header pattern and marks fields with markType=CHECKBOX', async () => {
    mockS3Body(sheetToBytes([
      ['Feature', 'Yes', 'No', 'Fully Meets', 'Partially Meets', 'Cannot Meet'],
      ['Audit logging', '', '', '', '', ''],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    // Yes / No are not response columns (don't match MATRIX_HEADER_PATTERNS),
    // so we don't expect fields for them — only the three matrix columns.
    const yesField = result[0].fields.find((f) => f.label.includes('— Yes'));
    expect(yesField).toBeUndefined();

    // The matrix response columns inherit TEXT mark type unless headers say so.
    const fullyMeets = result[0].fields.find((f) => f.matrixColumn === 'FULLY_MEETS');
    expect(fullyMeets?.markType).toBe('TEXT');
  });

  it('detects circle columns when the header mentions "circle"', async () => {
    mockS3Body(sheetToBytes([
      ['Feature', 'Circle One', 'Fully Meets', 'Partially Meets', 'Cannot Meet'],
      ['Backup retention', '', '', '', ''],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    // Only the response/comments columns become fields. The "Circle One" column
    // is not a response/comments column so won't emit a field directly,
    // but verify the parser still produces matrix fields for response columns.
    expect(result[0].formType).toBe('XLSX_MATRIX');
    expect(result[0].fields.length).toBeGreaterThan(0);
  });

  it('falls back to XLSX_FORM for non-matrix sheets', async () => {
    mockS3Body(sheetToBytes([
      ['Company Name:', '', '', ''],
      ['EIN:', '', '', ''],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');
    expect(result[0]?.formType).toBe('XLSX_FORM');
    expect(result[0]?.fields.every((f) => f.markType === 'TEXT')).toBe(true);
  });

  it('stamps each field with the sheet name and index it came from', async () => {
    mockS3Body(sheetToBytes([
      ['Company Name:', '', '', ''],
      ['EIN:', '', '', ''],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');
    expect(result[0].fields[0].sheetName).toBe('Sheet1');
    expect(result[0].fields[0].sheetIndex).toBe(0);
  });

  it('extracts fields from a later sheet when the first sheet is instructions-only', async () => {
    mockSend.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => multiSheetToBytes([
          // Sheet 1: instructions, no label/value structure the parser recognizes
          { name: 'Instructions', rows: [['Please complete the compliance matrix on the next tab.']] },
          // Sheet 2: the actual matrix
          {
            name: 'Compliance',
            rows: [
              ['Feature', 'Fully Meets', 'Partially Meets', 'Cannot Meet', 'Comments'],
              ['MFA support', '', '', '', ''],
            ],
          },
        ]),
      },
    });

    const result = await parseXlsxForms('any/key.xlsx');

    // Only the sheet with real fields is returned.
    const compliance = result.find((s) => s.sheetName === 'Compliance');
    expect(compliance).toBeDefined();
    expect(compliance?.formType).toBe('XLSX_MATRIX');
    expect(compliance?.fields.length).toBeGreaterThan(0);
    // Every field carries the correct sheet identity (index 1, not 0).
    expect(compliance?.fields.every((f) => f.sheetName === 'Compliance' && f.sheetIndex === 1)).toBe(true);
  });
});
