jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/helpers/questionFile', () => ({
  checkQuestionFileCancelled: jest.fn().mockResolvedValue(false),
  updateQuestionFile: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn().mockResolvedValue('# Question\nVendor Response\n1. Describe your approach\n2. List your experience'),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

jest.mock('@/helpers/json', () => ({
  safeParseJsonFromModel: jest.fn((text: string) => JSON.parse(text)),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.BEDROCK_MODEL_ID = 'us.anthropic.claude-opus-4-6-v1';
process.env.BEDROCK_REGION = 'us-east-1';

import { baseHandler, type ClassifyDocumentEvent, type ClassifyDocumentResult } from './classify-document';
import { checkQuestionFileCancelled, updateQuestionFile } from '@/helpers/questionFile';

const mockContext = {
  functionName: 'test',
  memoryLimitInMB: '128',
  awsRequestId: 'req-123',
  getRemainingTimeInMillis: () => 30000,
} as any;

const validEvent: ClassifyDocumentEvent = {
  questionFileId: 'qf-123',
  projectId: 'proj-456',
  opportunityId: 'opp-789',
  textFileKey: 'questions/text.txt',
  sourceFileKey: 'uploads/questionnaire.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  orgId: 'org-abc',
};

const makeBedrockResponse = (data: Record<string, unknown>) =>
  new TextEncoder().encode(
    JSON.stringify({
      content: [{ text: JSON.stringify(data) }],
      stop_reason: 'end_turn',
    }),
  );

describe('classify-document', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return OTHER when cancelled', async () => {
    (checkQuestionFileCancelled as jest.Mock).mockResolvedValueOnce(true);

    const result = await baseHandler(validEvent, mockContext);

    expect(result).toEqual({ docType: 'OTHER' });
    expect(updateQuestionFile).not.toHaveBeenCalled();
  });

  it('should throw when required fields are missing', async () => {
    await expect(
      baseHandler({ ...validEvent, projectId: '' }, mockContext),
    ).rejects.toThrow('Missing required fields');
  });

  it('should classify as QUESTIONNAIRE and save metadata', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      makeBedrockResponse({
        docType: 'QUESTIONNAIRE',
        questionColumn: 'B',
        answerColumn: 'C',
        firstDataRow: 10,
        sheetName: 'Vendor Questionnaire',
      }),
    );

    const result = await baseHandler(validEvent, mockContext);

    expect(result).toEqual<ClassifyDocumentResult>({
      docType: 'QUESTIONNAIRE',
      questionColumn: 'B',
      answerColumn: 'C',
      firstDataRow: 10,
      sheetName: 'Vendor Questionnaire',
    });

    expect(updateQuestionFile).toHaveBeenCalledWith(
      'proj-456', 'opp-789', 'qf-123',
      expect.objectContaining({
        docType: 'QUESTIONNAIRE',
        questionColumn: 'B',
        answerColumn: 'C',
        firstDataRow: 10,
        sheetName: 'Vendor Questionnaire',
      }),
    );
  });

  it('should classify as REQUIRED_FORM', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      makeBedrockResponse({ docType: 'REQUIRED_FORM' }),
    );

    const result = await baseHandler(validEvent, mockContext);

    expect(result).toEqual<ClassifyDocumentResult>({ docType: 'REQUIRED_FORM' });
    expect(updateQuestionFile).toHaveBeenCalledWith(
      'proj-456', 'opp-789', 'qf-123',
      expect.objectContaining({ docType: 'REQUIRED_FORM' }),
    );
  });

  it('should classify as OTHER for regular documents', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      makeBedrockResponse({ docType: 'OTHER' }),
    );

    const result = await baseHandler(validEvent, mockContext);

    expect(result).toEqual<ClassifyDocumentResult>({ docType: 'OTHER' });
    expect(updateQuestionFile).toHaveBeenCalledWith(
      'proj-456', 'opp-789', 'qf-123',
      expect.objectContaining({ docType: 'OTHER' }),
    );
  });

  it('should default to OTHER when AI returns invalid response', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify({
        content: [{ text: 'not json at all' }],
        stop_reason: 'end_turn',
      })),
    );

    const result = await baseHandler(validEvent, mockContext);

    expect(result).toEqual({ docType: 'OTHER' });
  });

  it('should default to OTHER when Bedrock call fails', async () => {
    mockInvokeModel.mockRejectedValueOnce(new Error('Throttling'));

    const result = await baseHandler(validEvent, mockContext);

    expect(result).toEqual({ docType: 'OTHER' });
    expect(updateQuestionFile).toHaveBeenCalledWith(
      'proj-456', 'opp-789', 'qf-123',
      expect.objectContaining({ docType: 'OTHER' }),
    );
  });

  it('should read orgId from the event and pass it as the 3rd arg to invokeModel', async () => {
    mockInvokeModel.mockResolvedValueOnce(makeBedrockResponse({ docType: 'OTHER' }));

    await baseHandler(validEvent, mockContext);

    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'org-abc',
    );
  });

  it('should pass undefined orgId to invokeModel when the event omits it', async () => {
    mockInvokeModel.mockResolvedValueOnce(makeBedrockResponse({ docType: 'OTHER' }));

    const { orgId: _omit, ...eventWithoutOrg } = validEvent;
    await baseHandler(eventWithoutOrg as ClassifyDocumentEvent, mockContext);

    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });

  it('should not include empty sheetName', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      makeBedrockResponse({
        docType: 'QUESTIONNAIRE',
        questionColumn: 'B',
        answerColumn: 'C',
        firstDataRow: 5,
        sheetName: '',
      }),
    );

    const result = await baseHandler(validEvent, mockContext);

    expect(result.sheetName).toBeUndefined();
  });
});
