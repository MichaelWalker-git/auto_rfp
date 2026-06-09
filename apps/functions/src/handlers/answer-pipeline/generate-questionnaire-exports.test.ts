jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-doc-id') }));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
}));

jest.mock('@/helpers/db', () => ({
  queryAllBySkPrefix: jest.fn(),
  updateItem: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/helpers/s3', () => ({
  uploadToS3: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/helpers/rfp-document', () => ({
  buildRFPDocumentS3Key: jest.fn(() => 'org/proj/opp/rfp-documents/mock-doc-id/v1/filled.xlsx'),
  buildRFPDocumentSK: jest.fn(() => 'proj#opp#mock-doc-id'),
  putRFPDocument: jest.fn().mockResolvedValue(undefined),
  listRFPDocumentsByProject: jest.fn().mockResolvedValue({ items: [] }),
}));

jest.mock('@/helpers/date', () => ({
  nowIso: jest.fn(() => '2026-05-19T12:00:00.000Z'),
}));

const mockGenerateHtmlQuestionnaireDocument = jest.fn().mockResolvedValue(undefined);
jest.mock('@/helpers/html-questionnaire-document', () => ({
  generateHtmlQuestionnaireDocument: mockGenerateHtmlQuestionnaireDocument,
}));

jest.mock('@/helpers/questionFile', () => ({
  updateQuestionFile: jest.fn().mockResolvedValue(undefined),
  isExtractedQuestionFile: jest.fn(() => true),
  listQuestionFilesByOpportunity: jest.fn().mockResolvedValue({ items: [] }),
}));

jest.mock('exceljs', () => {
  const mockWorksheet = {
    eachRow: jest.fn((cb: (row: any, num: number) => void) => {
      const rows = [
        { num: 10, cells: { 1: '1', 2: 'Describe your approach', 3: '' } },
        { num: 11, cells: { 1: '2', 2: 'List your experience', 3: '' } },
      ];
      for (const r of rows) {
        cb({
          getCell: (col: number) => ({ value: r.cells[col as keyof typeof r.cells] ?? null }),
        }, r.num);
      }
    }),
    getRow: jest.fn(() => ({
      getCell: jest.fn(() => ({ value: null })),
    })),
  };

  return {
    __esModule: true,
    default: {
      Workbook: jest.fn(() => ({
        xlsx: {
          load: jest.fn().mockResolvedValue(undefined),
          writeBuffer: jest.fn().mockResolvedValue(Buffer.from('xlsx-data')),
        },
        getWorksheet: jest.fn(() => mockWorksheet),
        worksheets: [mockWorksheet],
      })),
    },
  };
});

process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { baseHandler, type GenerateQuestionnaireExportsEvent } from './generate-questionnaire-exports';
import { queryAllBySkPrefix } from '@/helpers/db';
import { uploadToS3 } from '@/helpers/s3';
import { putRFPDocument } from '@/helpers/rfp-document';

const mockContext = { functionName: 'test', getRemainingTimeInMillis: () => 30000 } as any;

describe('generate-questionnaire-exports', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockS3Send.mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) },
    });

    (queryAllBySkPrefix as jest.Mock).mockImplementation((pk: string, prefix: string) => {
      if (pk === 'QUESTION_FILE') {
        return Promise.resolve([{
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj#opp#qf-1',
          questionFileId: 'qf-1',
          docType: 'QUESTIONNAIRE',
          questionColumn: 'B',
          answerColumn: 'C',
          firstDataRow: 10,
          fileKey: 'uploads/q.xlsx',
          originalFileName: 'Vendor_Questionnaire.xlsx',
          orgId: 'org-1',
        }]);
      }
      if (pk === 'QUESTION') {
        return Promise.resolve([
          { partition_key: 'QUESTION', sort_key: 'sk1', questionId: 'q1', sourceRow: 10, question: 'Describe your approach' },
          { partition_key: 'QUESTION', sort_key: 'sk2', questionId: 'q2', sourceRow: 11, question: 'List your experience' },
        ]);
      }
      if (pk === 'ANSWER') {
        return Promise.resolve([
          { partition_key: 'ANSWER', sort_key: 'sk1', questionId: 'q1', text: 'Our approach is agile.' },
          { partition_key: 'ANSWER', sort_key: 'sk2', questionId: 'q2', text: '10 years experience.' },
        ]);
      }
      if (pk === 'RFP_DOCUMENT') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
  });

  it('should generate filled XLSX and create RFP document', async () => {
    const event: GenerateQuestionnaireExportsEvent = {
      projectId: 'proj',
      orgId: 'org-1',
      opportunityId: 'opp',
    };

    const result = await baseHandler(event, mockContext);

    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(uploadToS3).toHaveBeenCalled();
    expect(putRFPDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: 'QUESTIONNAIRE',
        status: 'READY',
        documentId: 'mock-doc-id',
      }),
    );
  });

  it('should skip when no questionnaire files exist', async () => {
    (queryAllBySkPrefix as jest.Mock).mockImplementation((pk: string) => {
      if (pk === 'QUESTION_FILE') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const result = await baseHandler(
      { projectId: 'proj', orgId: 'org-1', opportunityId: 'opp' },
      mockContext,
    );

    expect(result).toEqual({ generated: 0, skipped: 0 });
    expect(uploadToS3).not.toHaveBeenCalled();
  });

  it('should skip when no answers exist for the file', async () => {
    (queryAllBySkPrefix as jest.Mock).mockImplementation((pk: string) => {
      if (pk === 'QUESTION_FILE') {
        return Promise.resolve([{
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj#opp#qf-1',
          questionFileId: 'qf-1',
          docType: 'QUESTIONNAIRE',
          questionColumn: 'B',
          answerColumn: 'C',
          firstDataRow: 10,
          fileKey: 'uploads/q.xlsx',
          originalFileName: 'q.xlsx',
          orgId: 'org-1',
        }]);
      }
      if (pk === 'ANSWER') return Promise.resolve([]);
      if (pk === 'QUESTION') return Promise.resolve([{ questionId: 'q1', sourceRow: 10 }]);
      return Promise.resolve([]);
    });

    const result = await baseHandler(
      { projectId: 'proj', orgId: 'org-1', opportunityId: 'opp' },
      mockContext,
    );

    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(0);
  });

  it('should skip when export already exists', async () => {
    const { listRFPDocumentsByProject } = require('@/helpers/rfp-document');
    (listRFPDocumentsByProject as jest.Mock).mockResolvedValueOnce({
      items: [{ documentType: 'QUESTIONNAIRE', originalFileName: 'Vendor_Questionnaire-filled.xlsx' }],
    });

    const result = await baseHandler(
      { projectId: 'proj', orgId: 'org-1', opportunityId: 'opp' },
      mockContext,
    );

    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(0);
  });

  it('should skip file with no worksheet (corrupted XLSX)', async () => {
    const ExcelJS = require('exceljs');
    const originalWorkbook = ExcelJS.default.Workbook;

    // Mock a workbook with no worksheets
    ExcelJS.default.Workbook = jest.fn(() => ({
      xlsx: {
        load: jest.fn().mockResolvedValue(undefined),
        writeBuffer: jest.fn().mockResolvedValue(Buffer.from('xlsx-data')),
      },
      getWorksheet: jest.fn(() => undefined),
      worksheets: [], // Empty worksheets array
    }));

    (queryAllBySkPrefix as jest.Mock).mockImplementation((pk: string) => {
      if (pk === 'QUESTION_FILE') {
        return Promise.resolve([{
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj#opp#qf-bad',
          questionFileId: 'qf-bad',
          docType: 'QUESTIONNAIRE',
          questionColumn: 'B',
          answerColumn: 'C',
          firstDataRow: 10,
          fileKey: 'uploads/corrupted.xlsx',
          originalFileName: 'corrupted.xlsx',
          orgId: 'org-1',
        }]);
      }
      if (pk === 'ANSWER') {
        return Promise.resolve([
          { partition_key: 'ANSWER', sort_key: 'sk1', questionId: 'q1', text: 'Answer 1' },
        ]);
      }
      if (pk === 'QUESTION') {
        return Promise.resolve([
          { partition_key: 'QUESTION', sort_key: 'sk1', questionId: 'q1', sourceRow: 10 },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await baseHandler(
      { projectId: 'proj', orgId: 'org-1', opportunityId: 'opp' },
      mockContext,
    );

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(uploadToS3).not.toHaveBeenCalled();

    // Restore original mock
    ExcelJS.default.Workbook = originalWorkbook;
  });

  it('should generate HTML documents for non-XLSX questionnaire files (DOCX/PDF)', async () => {
    (queryAllBySkPrefix as jest.Mock).mockImplementation((pk: string) => {
      if (pk === 'QUESTION_FILE') {
        return Promise.resolve([
          {
            partition_key: 'QUESTION_FILE',
            sort_key: 'proj#opp#qf-docx',
            questionFileId: 'qf-docx',
            docType: 'QUESTIONNAIRE',
            questionColumn: 'B',
            answerColumn: 'C',
            firstDataRow: 10,
            fileKey: 'uploads/questionnaire.docx',
            originalFileName: 'Vendor_Questionnaire.docx',
            orgId: 'org-1',
          },
        ]);
      }
      if (pk === 'QUESTION') {
        return Promise.resolve([
          {
            partition_key: 'QUESTION',
            sort_key: 'proj#opp#qf-docx#q1',
            questionId: 'q1',
            questionFileId: 'qf-docx',
            question: 'Test question',
          },
        ]);
      }
      if (pk === 'ANSWER') {
        return Promise.resolve([
          {
            partition_key: 'ANSWER',
            sort_key: 'proj#q1',
            questionId: 'q1',
            text: 'Test answer',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await baseHandler(
      { projectId: 'proj', orgId: 'org-1', opportunityId: 'opp' },
      mockContext,
    );

    // Should generate 1 HTML document for the DOCX file
    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockGenerateHtmlQuestionnaireDocument).toHaveBeenCalledTimes(1);
    expect(mockGenerateHtmlQuestionnaireDocument).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'proj',
      opportunityId: 'opp',
      questionFileId: 'qf-docx',
      originalFileName: 'Vendor_Questionnaire.docx',
    });
  });

  it('should return early when projectId or opportunityId missing', async () => {
    const result = await baseHandler(
      { projectId: '', orgId: 'org-1', opportunityId: 'opp' },
      mockContext,
    );

    expect(result).toEqual({ generated: 0, skipped: 0 });
  });
});
