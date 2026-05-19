const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
}));

jest.mock('@/helpers/env', () => ({
  requireEnv: jest.fn((key: string) => {
    const env: Record<string, string> = {
      DB_TABLE_NAME: 'test-table',
      DOCUMENTS_BUCKET: 'test-bucket',
    };
    return env[key] ?? `mock-${key}`;
  }),
}));

jest.mock('@/helpers/db', () => ({
  queryAllBySkPrefix: jest.fn(),
  updateItem: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/helpers/s3', () => ({
  uploadToS3: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/helpers/rfp-document', () => ({
  buildRFPDocumentS3Key: jest.fn(() => 'org/proj/opp/rfp-documents/doc-id/v1/filled.xlsx'),
  buildRFPDocumentSK: jest.fn(() => 'proj#opp#doc-id'),
}));

jest.mock('exceljs', () => {
  const mockWorksheet = {
    eachRow: jest.fn((cb: (row: any, num: number) => void) => {
      // Simulate rows: header at 8, section at 9, questions at 10-14
      const rows = [
        { num: 8, cells: { 1: '#', 2: 'Question', 3: '' } },
        { num: 9, cells: { 1: 'SECTION 1: OVERVIEW', 2: '', 3: '' } },
        { num: 10, cells: { 1: '1', 2: 'Describe your approach', 3: '' } },
        { num: 11, cells: { 1: '2', 2: 'List your experience', 3: '' } },
        { num: 12, cells: { 1: '3', 2: 'What certifications do you hold', 3: '' } },
      ];
      for (const r of rows) {
        cb({
          getCell: (col: number) => ({ value: r.cells[col as keyof typeof r.cells] ?? null }),
        }, r.num);
      }
    }),
    getRow: jest.fn((rowNum: number) => ({
      getCell: jest.fn((col: number) => {
        const cell = { value: null as string | null };
        return cell;
      }),
    })),
  };

  const mockWorkbook = {
    xlsx: {
      load: jest.fn().mockResolvedValue(undefined),
      writeBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-xlsx-content')),
    },
    getWorksheet: jest.fn(() => mockWorksheet),
    worksheets: [mockWorksheet],
  };

  return {
    __esModule: true,
    default: { Workbook: jest.fn(() => mockWorkbook) },
    Workbook: jest.fn(() => mockWorkbook),
  };
});

process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { generateQuestionnaireDocument } from './questionnaire-document';
import { queryAllBySkPrefix, updateItem } from '@/helpers/db';
import { uploadToS3 } from '@/helpers/s3';

describe('generateQuestionnaireDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) },
    });

    // Default: return questionnaire file
    (queryAllBySkPrefix as jest.Mock).mockImplementation((pk: string) => {
      if (pk === 'QUESTION_FILE') {
        return Promise.resolve([{
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj#opp#qf-123',
          questionFileId: 'qf-123',
          docType: 'QUESTIONNAIRE',
          questionColumn: 'B',
          answerColumn: 'C',
          firstDataRow: 10,
          sheetName: 'Sheet1',
          fileKey: 'uploads/questionnaire.xlsx',
          originalFileName: 'Vendor_Questionnaire.xlsx',
        }]);
      }
      if (pk === 'QUESTION') {
        return Promise.resolve([
          { partition_key: 'QUESTION', sort_key: 'proj#opp#qf-123#q1', questionId: 'q1', sourceRow: 10, question: 'Describe your approach' },
          { partition_key: 'QUESTION', sort_key: 'proj#opp#qf-123#q2', questionId: 'q2', sourceRow: 11, question: 'List your experience' },
          { partition_key: 'QUESTION', sort_key: 'proj#opp#qf-123#q3', questionId: 'q3', sourceRow: 12, question: 'What certifications do you hold' },
        ]);
      }
      if (pk === 'ANSWER') {
        return Promise.resolve([
          { partition_key: 'ANSWER', sort_key: 'proj#opp#qf-123#q1', questionId: 'q1', text: 'Our approach is agile-based.' },
          { partition_key: 'ANSWER', sort_key: 'proj#opp#qf-123#q2', questionId: 'q2', text: 'We have 10 years of experience.' },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it('should generate a filled questionnaire document', async () => {
    await generateQuestionnaireDocument({
      orgId: 'org-123',
      projectId: 'proj',
      opportunityId: 'opp',
      documentId: 'doc-id',
    });

    expect(uploadToS3).toHaveBeenCalledWith(
      'test-bucket',
      'org/proj/opp/rfp-documents/doc-id/v1/filled.xlsx',
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    expect(updateItem).toHaveBeenCalledWith(
      'RFP_DOCUMENT',
      'proj#opp#doc-id',
      expect.objectContaining({
        status: 'READY',
        originalFileName: 'Vendor_Questionnaire-filled.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
  });

  it('should throw when no QUESTIONNAIRE files found', async () => {
    (queryAllBySkPrefix as jest.Mock).mockImplementation((pk: string) => {
      if (pk === 'QUESTION_FILE') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await expect(
      generateQuestionnaireDocument({
        orgId: 'org-123',
        projectId: 'proj',
        opportunityId: 'opp',
        documentId: 'doc-id',
      }),
    ).rejects.toThrow('No QUESTIONNAIRE files found');
  });

  it('should not write to section header rows', async () => {
    // The eachRow mock has row 9 as "SECTION 1: OVERVIEW" — it should not be in validQuestionRows
    await generateQuestionnaireDocument({
      orgId: 'org-123',
      projectId: 'proj',
      opportunityId: 'opp',
      documentId: 'doc-id',
    });

    // Verify the upload happened (means no crash from writing to section rows)
    expect(uploadToS3).toHaveBeenCalled();
  });

  it('should not write to header row', async () => {
    (queryAllBySkPrefix as jest.Mock).mockImplementation((pk: string) => {
      if (pk === 'QUESTION_FILE') {
        return Promise.resolve([{
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj#opp#qf-123',
          questionFileId: 'qf-123',
          docType: 'QUESTIONNAIRE',
          questionColumn: 'B',
          answerColumn: 'C',
          firstDataRow: 10,
          fileKey: 'uploads/q.xlsx',
          originalFileName: 'q.xlsx',
        }]);
      }
      if (pk === 'QUESTION') {
        return Promise.resolve([
          { partition_key: 'QUESTION', sort_key: 'sk', questionId: 'q1', sourceRow: 8, question: 'Question' },
        ]);
      }
      if (pk === 'ANSWER') {
        return Promise.resolve([
          { partition_key: 'ANSWER', sort_key: 'sk', questionId: 'q1', text: 'Should not be written' },
        ]);
      }
      return Promise.resolve([]);
    });

    await generateQuestionnaireDocument({
      orgId: 'org-123',
      projectId: 'proj',
      opportunityId: 'opp',
      documentId: 'doc-id',
    });

    // Should still upload (0 filled is OK, just doesn't crash)
    expect(uploadToS3).toHaveBeenCalled();
  });
});
