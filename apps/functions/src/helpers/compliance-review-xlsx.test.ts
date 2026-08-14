import * as XLSX from 'xlsx';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  GetObjectCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { readQuestionnaireCellInventory } from './compliance-review-xlsx';

const sheetToBytes = (
  rows: (string | number | null)[][],
  sheetName = 'Sheet1',
): Uint8Array => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

const multiSheetToBytes = (
  sheets: { name: string; rows: (string | number | null)[][] }[],
): Uint8Array => {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

const mockS3Body = (bytes: Uint8Array) => {
  mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => bytes } });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('readQuestionnaireCellInventory', () => {
  it('reads non-empty cells with 0-based coords and A1 refs', async () => {
    mockS3Body(
      sheetToBytes([
        ['Question', 'Answer'],
        ['Company name?', 'Acme Corp'],
      ]),
    );

    const inv = await readQuestionnaireCellInventory('any/key.xlsx');

    expect(inv).not.toBeNull();
    expect(inv!.sheetName).toBe('Sheet1');
    // 4 non-empty cells (2×2), all populated
    expect(inv!.cells).toHaveLength(4);

    const answer = inv!.cells.find((c) => c.value === 'Acme Corp');
    expect(answer).toBeDefined();
    // "Acme Corp" is B2 → row 1, col 1 (0-based), ref B2
    expect(answer!.row).toBe(1);
    expect(answer!.col).toBe(1);
    expect(answer!.ref).toBe('B2');
  });

  it('skips empty / whitespace-only cells', async () => {
    mockS3Body(
      sheetToBytes([
        ['Q1', ''],
        ['', '   '],
        ['Q3', 'A3'],
      ]),
    );

    const inv = await readQuestionnaireCellInventory('any/key.xlsx');
    // Only Q1, Q3, A3 are non-empty
    const values = inv!.cells.map((c) => c.value).sort();
    expect(values).toEqual(['A3', 'Q1', 'Q3']);
  });

  it('only inventories the FIRST sheet (matches the editor)', async () => {
    mockS3Body(
      multiSheetToBytes([
        { name: 'First', rows: [['only this']] },
        { name: 'Second', rows: [['ignored']] },
      ]),
    );

    const inv = await readQuestionnaireCellInventory('any/key.xlsx');
    expect(inv!.sheetName).toBe('First');
    expect(inv!.cells).toHaveLength(1);
    expect(inv!.cells[0]!.value).toBe('only this');
  });

  it('stringifies numeric values via the formatted text', async () => {
    mockS3Body(sheetToBytes([['Price', 1234]]));
    const inv = await readQuestionnaireCellInventory('any/key.xlsx');
    const price = inv!.cells.find((c) => c.col === 1);
    expect(price!.value).toBe('1234');
  });

  it('truncates long cell values by default but keeps them full when maxCellChars is Infinity (WR-2)', async () => {
    const long = 'x'.repeat(500);
    mockS3Body(sheetToBytes([['Answer', long]]));
    const truncated = await readQuestionnaireCellInventory('any/key.xlsx');
    const tCell = truncated!.cells.find((c) => c.col === 1)!;
    expect(tCell.value).toContain('[TRUNCATED]');
    expect(tCell.value.length).toBeLessThan(long.length);

    mockS3Body(sheetToBytes([['Answer', long]]));
    const full = await readQuestionnaireCellInventory('any/key.xlsx', { maxCellChars: Infinity });
    const fCell = full!.cells.find((c) => c.col === 1)!;
    expect(fCell.value).toBe(long);
    expect(fCell.value).not.toContain('[TRUNCATED]');
  });

  it('returns null when the S3 object has no body', async () => {
    mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => undefined } });
    await expect(readQuestionnaireCellInventory('any/key.xlsx')).resolves.toBeNull();
  });

  it('returns null (never throws) when S3 fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(readQuestionnaireCellInventory('any/key.xlsx')).resolves.toBeNull();
  });

  it('flags truncation when the sheet exceeds the scan window', async () => {
    // 600 rows > MAX_QUESTIONNAIRE_ROWS (500) → truncated, capped rows scanned.
    const rows = Array.from({ length: 600 }, (_, i) => [`row ${i}`]);
    mockS3Body(sheetToBytes(rows));

    const inv = await readQuestionnaireCellInventory('any/key.xlsx');
    expect(inv!.truncated).toBe(true);
    // No cell beyond the 500-row window (row index 499 is the last scanned).
    expect(inv!.cells.every((c) => c.row < 500)).toBe(true);
  });
});
