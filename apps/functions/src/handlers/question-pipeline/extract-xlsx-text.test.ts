/**
 * Tests for extract-xlsx-text, focused on the row-to-text conversion.
 *
 * Regression: wide, sparse sheets rendered every row up to the sheet's max
 * column width, so a single value became "value\t\t\t…" (dozens of trailing
 * tabs). That whitespace bloat fed the downstream chunker and hurt LLM
 * extraction. Trailing empty cells are now trimmed; interior empties (which
 * carry column position) are preserved.
 */

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/helpers/questionFile', () => ({
  checkQuestionFileCancelled: jest.fn().mockResolvedValue(false),
  updateQuestionFile: jest.fn().mockResolvedValue({ success: true }),
}));

// getFileFromS3 returns an S3 body stream; the handler consumes it via
// `for await...of`, so the mock must be async-iterable and yield Buffer chunks.
const makeStream = () => ({
  async *[Symbol.asyncIterator]() {
    yield Buffer.from('fake-xlsx');
  },
});
const mockGetFileFromS3 = jest.fn().mockResolvedValue(makeStream());
const mockUploadToS3 = jest.fn().mockResolvedValue(undefined);
jest.mock('@/helpers/s3', () => ({
  getFileFromS3: (...args: unknown[]) => mockGetFileFromS3(...args),
  uploadToS3: (...args: unknown[]) => mockUploadToS3(...args),
}));

const mockSheetToJson = jest.fn();
jest.mock('xlsx', () => ({
  read: jest.fn(() => ({
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: {} },
  })),
  utils: {
    sheet_to_json: (...args: unknown[]) => mockSheetToJson(...args),
  },
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { handler } from './extract-xlsx-text';

const event = {
  opportunityId: 'opp-1',
  projectId: 'proj-1',
  questionFileId: 'qf-1',
  sourceFileKey: 'org/file.xlsx',
};

const mockContext = { getRemainingTimeInMillis: () => 30000 } as never;

// The uploaded text is the second positional arg to uploadToS3(bucket, key, body, ...).
const uploadedText = (): string => String(mockUploadToS3.mock.calls[0]![2]);

describe('extract-xlsx-text row conversion', () => {
  beforeEach(() => {
    mockUploadToS3.mockClear();
    mockSheetToJson.mockReset();
  });

  it('trims trailing empty cells from a wide sparse row', async () => {
    mockSheetToJson.mockReturnValue([
      ['Item', '', '', '', '', '', '', ''],
    ]);

    await handler(event, mockContext, () => {});

    const text = uploadedText();
    expect(text).toContain('Item');
    // No trailing-tab bloat.
    expect(text).not.toContain('Item\t');
  });

  it('preserves interior empty cells (column positions up to the last filled cell)', async () => {
    mockSheetToJson.mockReturnValue([
      ['A', '', 'C', '', '', ''],
    ]);

    await handler(event, mockContext, () => {});

    const line = uploadedText().split('\n').find((l) => l.includes('A'))!;
    expect(line).toBe('A\t\tC');
  });

  it('drops fully empty rows', async () => {
    mockSheetToJson.mockReturnValue([
      ['', '', ''],
      ['Real', 'Data'],
    ]);

    await handler(event, mockContext, () => {});

    const lines = uploadedText().split('\n').filter((l) => l.trim());
    // Only the header line and the "Real\tData" line — no empty-row artifact.
    expect(lines).toContain('Real\tData');
    expect(lines.some((l) => l === '')).toBe(false);
  });
});
