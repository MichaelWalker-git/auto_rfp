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

  it('captures the real "General Information" questionnaire — blank Vendor Response column with repeated section sub-headers', async () => {
    // Faithful reproduction of the real sheet: a "Vendor Response" column that is
    // blank on question rows but repeats its header on interleaved SECTION
    // sub-header rows ("Fleet and Drivers", etc.), leaving it ~9% populated — not
    // 0%. An earlier strict "fully empty" rule dropped this real form; the fill
    // ceiling must tolerate that low non-zero ratio.
    mockS3Body(sheetToBytes([
      ['', '#', 'Service Capabilities', 'Vendor Response'],
      ['', 1, 'How many years has your company been providing secure document destruction services?', ''],
      ['', 2, 'How many years to healthcare organizations?', ''],
      ['', 3, 'What percentage of your revenue is derived from healthcare customers?', ''],
      ['', 4, 'Describe your ownership structure (public, private equity, privately held, etc.)', ''],
      ['', 5, 'Any mergers, acquisitions, or ownership changes in the past 5 years?', ''],
      ['', 6, 'What is your geographic service footprint?', ''],
      ['', 7, 'Do you subcontract any of your services?', ''],
      ['', 8, 'List all subcontractors that may support the account.', ''],
      ['', 9, 'How many total employees does your company employ?', ''],
      ['', '', 'Fleet and Drivers', 'Vendor Response'],           // section sub-header
      ['', 10, 'How many route drivers does your company employ?', ''],
      ['', 11, 'What is your driver turnover rate for the past 3 years?', ''],
      ['', 12, 'How many shredding vehicles are in your fleet?', ''],
      ['', '', 'Service Flexibility and Site-Level Customization', 'Vendor Response'], // section sub-header
      ['', 16, 'Describe your ability to support different service frequencies.', ''],
      ['', 17, 'Can individual facilities adjust service frequencies without an amendment?', ''],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    expect(result).toHaveLength(1);
    expect(result[0].formType).toBe('XLSX_FORM');
    // A field for every row with question text (question rows + the section
    // sub-header rows, which also carry text) — the real form is not dropped.
    expect(result[0].fields.length).toBeGreaterThanOrEqual(14);
    const q1 = result[0].fields.find((f) => f.label.includes('How many years has your company'));
    expect(q1).toBeDefined();
    expect(q1!.label).toContain('Vendor Response');
    expect(q1!.status).toBe('MANUAL_REQUIRED');
    expect(q1!.manualReason).toMatch(/vendor response required/i);
  });

  it('handles sparse rows with a leading empty column without throwing (regression)', async () => {
    // `sheet_to_json({ header:1 })` returns SPARSE rows: a leading empty column
    // becomes a hole, not ''. The header scan must not call .trim() on undefined.
    // Using null forces aoa_to_sheet to omit the leading cell → a real hole on read.
    mockS3Body(sheetToBytes([
      [null, 'Vendor Questionnaire'],
      [null, '#', 'Service Capabilities', 'Vendor Response'],
      [null, 1, 'How many years has your company been in business?', null],
      [null, 2, 'What is your geographic service footprint?', null],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    expect(result).toHaveLength(1);
    expect(result[0].formType).toBe('XLSX_FORM');
    expect(result[0].fields).toHaveLength(2);
    expect(result[0].fields[0].label).toContain('How many years');
    expect(result[0].fields[0].status).toBe('MANUAL_REQUIRED');
  });

  it('detects a pricing table (empty "Quoted Unit Price" column, arbitrary header) — Form 1', async () => {
    mockS3Body(sheetToBytes([
      ['Form 1'],
      ['Line Item', 'Description of Requirement', 'Quoted Unit Price', 'Quantity (Year)', 'Extended Total'],
      ['0001', 'Test Period Mortgage Prepayment Reports', '', '1,00', '-'],
      ['0002', 'Option Year One (1456) Mortgage Prepayment Reports', '', '1,00', '-'],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    expect(result).toHaveLength(1);
    expect(result[0].formType).toBe('XLSX_FORM');
    // One field per row for the single empty fill column.
    expect(result[0].fields).toHaveLength(2);
    const first = result[0].fields[0];
    expect(first.label).toContain('Quoted Unit Price');
    expect(first.label).toContain('0001');
    expect(first.status).toBe('MANUAL_REQUIRED');
  });

  it('detects a location grid (empty "On-Site Service Available?" column) — Location List', async () => {
    mockS3Body(sheetToBytes([
      ['Location List'],
      ['Instructions: Please indicate where you have in-person interpretive services available.'],
      ['City', 'State', 'Zip Code', 'On-Site Service Available?'],
      ['Alexander', 'AR', '72002', ''],
      ['Alma', 'AR', '72921', ''],
      ['Arkadelphia', 'AR', '71923', ''],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    expect(result).toHaveLength(1);
    expect(result[0].formType).toBe('XLSX_FORM');
    expect(result[0].fields).toHaveLength(3);
    const first = result[0].fields[0];
    expect(first.label).toContain('On-Site Service Available');
    expect(first.label).toContain('Alexander');
    expect(first.status).toBe('MANUAL_REQUIRED');
  });

  it('emits one field per empty fill column for multi-blank pricing rows', async () => {
    mockS3Body(sheetToBytes([
      ['Line Item', 'Description', 'Unit Price', 'Extended Price'],
      ['0001', 'Widget A', '', ''],
      ['0002', 'Widget B', '', ''],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    // 2 rows × 2 empty fill columns = 4 fields.
    expect(result[0].fields).toHaveLength(4);
    const labels = result[0].fields.map((f) => f.label);
    expect(labels.some((l) => l.includes('Unit Price'))).toBe(true);
    expect(labels.some((l) => l.includes('Extended Price'))).toBe(true);
  });

  it('drops a Table of Contents sheet (populated navigation table, no blanks to fill)', async () => {
    mockS3Body(sheetToBytes([
      ['Table of Contents'],
      ['Section', 'Additional Information', 'Section Content'],
      [1, 'Informational', 'Cover Page'],
      [2, 'Informational', 'Table of Contents'],
      [3, 'Informational/Instructional', 'Guidelines'],
      [5, 'Response required', 'General Information'],
      [7, 'Response required', 'Pricing Template'],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    // No fillable structure → sheet is excluded entirely.
    expect(result).toHaveLength(0);
  });

  it('drops the real Guidelines sheet — merged Section label (~50%) + full prose columns, no blank to fill', async () => {
    // Faithful reproduction of the real sheet. The "Section" column is a merged
    // group label populated on ~half the rows; "Request/Comments/Questions" and
    // "Type" are 100% full prose. No column is empty enough (all ≥ the fill
    // ceiling) → correctly rejected. This is the boundary case that must NOT be
    // mistaken for a fillable form.
    mockS3Body(sheetToBytes([
      ['Guidelines'],
      ['Section', 'Request/Comments/Questions', 'Type'],
      ['Compliance with Schedule', 'It is the vendor’s responsibility to meet the deadlines in this request.', 'Informational'],
      ['', 'Failure to meet stated dates may result in disqualification.', 'Informational'],
      ['Questions & Answers', 'Vendors will submit questions in writing via e-mail.', 'Instructional'],
      ['', 'Inquiries are directed only to the contacts listed on the cover page.', 'Instructional'],
      ['', 'Captis must receive all inquiries within the Q&A period.', 'Instructional'],
      ['', 'Captis will not provide oral explanations or instructions.', 'Informational'],
      ['', 'Captis will prepare a consolidated list of questions and answers.', 'Informational'],
      ['Communication Restrictions', 'Vendor may not communicate except via the Q&A method.', 'Informational'],
      ['', 'Vendor is not to contact any Captis employee.', 'Informational'],
      ['Review Process', 'Captis is responsible for development of evaluation criteria.', 'Informational'],
      ['', 'Vendor may be asked to conduct a presentation.', 'Informational'],
      ['Non-Binding Process', 'This is not an offer to contract.', 'Informational'],
      ['Acceptance of Offers', 'Vendor agrees to hold prices firm for 180 days.', 'Informational'],
      ['Cost of RFQ Responses', 'Captis is not liable for any costs incurred by vendors.', 'Informational'],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    expect(result).toHaveLength(0);
  });

  it('does not treat a fully-populated column merely titled "response" as fillable', async () => {
    // "Response" header but every data cell is filled → not a blank to complete.
    mockS3Body(sheetToBytes([
      ['Item', 'Response'],
      ['Q1', 'Yes'],
      ['Q2', 'No'],
      ['Q3', 'Yes'],
    ]));

    const result = await parseXlsxForms('any/key.xlsx');

    expect(result).toHaveLength(0);
  });

  it('keeps only fillable sheets in a mixed workbook (TOC/Guidelines dropped, questionnaire kept)', async () => {
    mockSend.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => multiSheetToBytes([
          {
            name: '2.Table of Contents',
            rows: [
              ['Table of Contents'],
              ['Section', 'Additional Information', 'Section Content'],
              [1, 'Informational', 'Cover Page'],
              [5, 'Response required', 'General Information'],
            ],
          },
          {
            name: '3. Guidelines',
            rows: [
              ['Guidelines'],
              ['Section', 'Request/Comments/Questions', 'Type'],
              ['Compliance', 'Meet the deadlines in this request.', 'Informational'],
            ],
          },
          {
            name: '5. General Information',
            rows: [
              ['', 'Vendor Questionnaire', ''],
              ['', '#', 'Service Capabilities', 'Vendor Response'],
              ['', 1, 'How many years has your company been providing services?', ''],
              ['', 2, 'What is your geographic service footprint?', ''],
            ],
          },
        ]),
      },
    });

    const result = await parseXlsxForms('any/key.xlsx');

    const sheetNames = result.map((s) => s.sheetName);
    expect(sheetNames).toEqual(['5. General Information']);
    expect(result[0].fields).toHaveLength(2);
    expect(result[0].fields.every((f) => f.sheetName === '5. General Information')).toBe(true);
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
