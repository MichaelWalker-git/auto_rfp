import ExcelJS from 'exceljs';

const mockGetBuffer = jest.fn();
const mockUpload = jest.fn();
jest.mock('@/helpers/s3', () => ({
  getFileBufferFromS3: (...a: unknown[]) => mockGetBuffer(...a),
  uploadToS3: (...a: unknown[]) => mockUpload(...a),
}));
jest.mock('@/helpers/env', () => ({ requireEnv: (_k: string, d?: string) => d ?? 'test-bucket' }));

process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { writeQuestionnaireCells } from './questionnaire-edit';

/**
 * Build a real .xlsx buffer with exceljs (the code path under test parses with
 * exceljs). Each sheet is name + rows of primitive values; optionally a style is
 * applied to a cell so we can assert style preservation.
 */
const wbToBuffer = async (
  sheets: { name: string; rows: (string | number | null)[][]; styleCell?: { ref: string } }[],
): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  for (const { name, rows, styleCell } of sheets) {
    const ws = wb.addWorksheet(name);
    rows.forEach((row, r) => row.forEach((v, c) => {
      if (v !== null) ws.getRow(r + 1).getCell(c + 1).value = v;
    }));
    if (styleCell) {
      ws.getCell(styleCell.ref).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' },
      };
    }
  }
  return (await wb.xlsx.writeBuffer()) as Buffer;
};

/** Decode the workbook the writer uploaded (last uploadToS3 body arg). */
const decodeUploaded = async (): Promise<ExcelJS.Workbook> => {
  const body = mockUpload.mock.calls.at(-1)![2] as Buffer;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ArrayBuffer);
  return wb;
};
const cellText = (wb: ExcelJS.Workbook, sheet: string, ref: string): string => {
  const t = wb.getWorksheet(sheet)?.getCell(ref).text;
  return t == null ? '' : String(t);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpload.mockResolvedValue(undefined);
});

describe('writeQuestionnaireCells', () => {
  it('writes a cell whose current value matches `before` and uploads the workbook', async () => {
    mockGetBuffer.mockResolvedValueOnce(
      await wbToBuffer([{ name: 'Sheet1', rows: [['Company', 'HORUSTECH'], ['Compliant', 'Yes']] }]),
    );

    const { results, wroteAny } = await writeQuestionnaireCells({
      fileKey: 'q/1.xlsx',
      writes: [{ ref: 'B1', sheetName: 'Sheet1', before: 'HORUSTECH', after: 'Horus Technology' }],
    });

    expect(wroteAny).toBe(true);
    expect(results).toEqual([{ ref: 'B1', status: 'applied' }]);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const wb = await decodeUploaded();
    expect(cellText(wb, 'Sheet1', 'B1')).toBe('Horus Technology');
  });

  it('skips (stale) a cell whose current value no longer equals `before` and does NOT upload', async () => {
    mockGetBuffer.mockResolvedValueOnce(
      await wbToBuffer([{ name: 'Sheet1', rows: [['Company', 'Something Else']] }]),
    );

    const { results, wroteAny } = await writeQuestionnaireCells({
      fileKey: 'q/1.xlsx',
      writes: [{ ref: 'B1', sheetName: 'Sheet1', before: 'HORUSTECH', after: 'Horus Technology' }],
    });

    expect(wroteAny).toBe(false);
    expect(results[0].status).toBe('skipped-stale');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('preserves untouched cells, other sheets, AND cell styling (fidelity)', async () => {
    mockGetBuffer.mockResolvedValueOnce(
      await wbToBuffer([
        { name: 'Answers', rows: [['Company', 'HORUSTECH'], ['Phone', '555-1234']], styleCell: { ref: 'A1' } },
        { name: 'Instructions', rows: [['Do not edit this tab']] },
      ]),
    );

    await writeQuestionnaireCells({
      fileKey: 'q/1.xlsx',
      writes: [{ ref: 'B1', sheetName: 'Answers', before: 'HORUSTECH', after: 'Horus Technology' }],
    });

    const wb = await decodeUploaded();
    // Edited cell changed…
    expect(cellText(wb, 'Answers', 'B1')).toBe('Horus Technology');
    // …untouched cell in the same sheet preserved…
    expect(cellText(wb, 'Answers', 'B2')).toBe('555-1234');
    // …the whole other sheet survives…
    expect(wb.worksheets.map((w) => w.name)).toContain('Instructions');
    expect(cellText(wb, 'Instructions', 'A1')).toBe('Do not edit this tab');
    // …and the styled cell keeps its fill (the SheetJS-write regression this guards against).
    const fill = wb.getWorksheet('Answers')!.getCell('A1').fill as ExcelJS.FillPattern | undefined;
    expect(fill?.type).toBe('pattern');
    expect(fill?.fgColor?.argb).toBe('FFFF0000');
  });

  it('falls back to the first sheet when the named sheet is absent', async () => {
    mockGetBuffer.mockResolvedValueOnce(
      await wbToBuffer([{ name: 'RealSheetName', rows: [['Company', 'HORUSTECH']] }]),
    );

    const { results } = await writeQuestionnaireCells({
      fileKey: 'q/1.xlsx',
      writes: [{ ref: 'B1', sheetName: 'WrongName', before: 'HORUSTECH', after: 'Horus Technology' }],
    });

    expect(results[0].status).toBe('applied');
    const wb = await decodeUploaded();
    expect(cellText(wb, 'RealSheetName', 'B1')).toBe('Horus Technology');
  });

  it('applies matching cells and skips stale ones in a mixed batch (one upload)', async () => {
    mockGetBuffer.mockResolvedValueOnce(
      await wbToBuffer([{ name: 'Sheet1', rows: [['A', 'keep'], ['B', 'changed-already']] }]),
    );

    const { results, wroteAny } = await writeQuestionnaireCells({
      fileKey: 'q/1.xlsx',
      writes: [
        { ref: 'B1', sheetName: 'Sheet1', before: 'keep', after: 'new-1' },
        { ref: 'B2', sheetName: 'Sheet1', before: 'stale-before', after: 'new-2' },
      ],
    });

    expect(wroteAny).toBe(true);
    expect(results.find((r) => r.ref === 'B1')!.status).toBe('applied');
    expect(results.find((r) => r.ref === 'B2')!.status).toBe('skipped-stale');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const wb = await decodeUploaded();
    expect(cellText(wb, 'Sheet1', 'B1')).toBe('new-1');
    expect(cellText(wb, 'Sheet1', 'B2')).toBe('changed-already');
  });

  it('M3: a numeric cell edited to another number STAYS numeric (not coerced to text)', async () => {
    mockGetBuffer.mockResolvedValueOnce(
      await wbToBuffer([{ name: 'Sheet1', rows: [['Price', 1234]] }]),
    );

    const { results } = await writeQuestionnaireCells({
      fileKey: 'q/1.xlsx',
      writes: [{ ref: 'B1', sheetName: 'Sheet1', before: '1234', after: '5678' }],
    });

    expect(results[0].status).toBe('applied');
    const cell = (await decodeUploaded()).getWorksheet('Sheet1')!.getCell('B1');
    expect(typeof cell.value).toBe('number');
    expect(cell.value).toBe(5678);
  });

  it('M3: a TEXT cell whose value looks numeric stays TEXT (no leading-zero/format loss)', async () => {
    // A phone/zip-like text answer must not become a number.
    mockGetBuffer.mockResolvedValueOnce(
      await wbToBuffer([{ name: 'Sheet1', rows: [['Code', '007']] }]),
    );

    const { results } = await writeQuestionnaireCells({
      fileKey: 'q/1.xlsx',
      writes: [{ ref: 'B1', sheetName: 'Sheet1', before: '007', after: '042' }],
    });

    expect(results[0].status).toBe('applied');
    const cell = (await decodeUploaded()).getWorksheet('Sheet1')!.getCell('B1');
    expect(typeof cell.value).toBe('string');
    expect(cell.value).toBe('042');
  });

  it('M3: a numeric cell edited to non-numeric text becomes text', async () => {
    mockGetBuffer.mockResolvedValueOnce(
      await wbToBuffer([{ name: 'Sheet1', rows: [['Qty', 5]] }]),
    );

    const { results } = await writeQuestionnaireCells({
      fileKey: 'q/1.xlsx',
      writes: [{ ref: 'B1', sheetName: 'Sheet1', before: '5', after: 'TBD' }],
    });

    expect(results[0].status).toBe('applied');
    const cell = (await decodeUploaded()).getWorksheet('Sheet1')!.getCell('B1');
    expect(cell.value).toBe('TBD');
  });

  it('M3: an empty replacement clears the cell (null)', async () => {
    mockGetBuffer.mockResolvedValueOnce(
      await wbToBuffer([{ name: 'Sheet1', rows: [['Note', 'delete me']] }]),
    );

    const { results } = await writeQuestionnaireCells({
      fileKey: 'q/1.xlsx',
      writes: [{ ref: 'B1', sheetName: 'Sheet1', before: 'delete me', after: '' }],
    });

    expect(results[0].status).toBe('applied');
    const cell = (await decodeUploaded()).getWorksheet('Sheet1')!.getCell('B1');
    // Cleared cells read back as null/empty.
    expect(cell.value == null || cell.value === '').toBe(true);
  });
});
