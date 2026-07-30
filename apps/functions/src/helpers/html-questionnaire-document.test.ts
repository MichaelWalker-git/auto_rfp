jest.mock('@/constants/common', () => ({
  PK_NAME: 'PK',
  SK_NAME: 'SK',
}));

jest.mock('@/constants/rfp-document', () => ({
  RFP_DOCUMENT_PK: 'RFP_DOCUMENT',
}));

const mockNowIso = jest.fn(() => '2026-06-08T10:00:00.000Z');
jest.mock('@/helpers/date', () => ({
  nowIso: mockNowIso,
}));

const mockBuildRFPDocumentSK = jest.fn((projectId: string, opportunityId: string, documentId: string) =>
  `${projectId}#${opportunityId}#${documentId}`
);
const mockPutRFPDocument = jest.fn().mockResolvedValue(undefined);
const mockUploadRFPDocumentHtml = jest.fn().mockResolvedValue('s3-key-mock-doc-id.html');
jest.mock('@/helpers/rfp-document', () => ({
  buildRFPDocumentSK: mockBuildRFPDocumentSK,
  putRFPDocument: mockPutRFPDocument,
  uploadRFPDocumentHtml: mockUploadRFPDocumentHtml,
}));

const mockGetTemplate = jest.fn().mockResolvedValue(null);
const mockFindBestTemplate = jest.fn().mockResolvedValue(null);
const mockLoadTemplateHtml = jest.fn().mockResolvedValue(null);
const mockReplaceMacros = jest.fn((html: string) => html);
jest.mock('@/helpers/template', () => ({
  getTemplate: mockGetTemplate,
  findBestTemplate: mockFindBestTemplate,
  loadTemplateHtml: mockLoadTemplateHtml,
  replaceMacros: mockReplaceMacros,
}));

const mockGetProjectById = jest.fn().mockResolvedValue({ name: 'Test Project' });
const mockGetOrganizationById = jest.fn().mockResolvedValue({ name: 'Test Org' });
const mockGetOpportunity = jest.fn().mockResolvedValue({ item: { id: 'opp-1', title: 'Test Opportunity' } });
jest.mock('@/helpers/project', () => ({ getProjectById: mockGetProjectById }));
jest.mock('@/helpers/org', () => ({ getOrganizationById: mockGetOrganizationById }));
jest.mock('@/helpers/opportunity', () => ({ getOpportunity: mockGetOpportunity }));

const mockLoadQuestions = jest.fn();
const mockLoadAnswers = jest.fn();
const mockGroupQuestions = jest.fn();
const mockBuildSectionsHtml = jest.fn();
const mockEscapeHtml = jest.fn((str: string) => str);

jest.mock('@/helpers/qa-shared', () => ({
  loadQuestions: mockLoadQuestions,
  loadAnswers: mockLoadAnswers,
  groupQuestions: mockGroupQuestions,
  buildSectionsHtml: mockBuildSectionsHtml,
  escapeHtml: mockEscapeHtml,
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-doc-id'),
}));

import { generateHtmlQuestionnaireDocument } from './html-questionnaire-document';
import type { QuestionItem, AnswerItem } from '@auto-rfp/core';

describe('html-questionnaire-document', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseParams = {
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    questionFileId: 'qf-docx-1',
    originalFileName: 'vendor-form.docx',
  };

  it('should generate HTML document filtered by questionFileId', async () => {
    // Mock questions: 3 total, 2 from our file
    const allQuestions: Partial<QuestionItem>[] = [
      { questionId: 'q1', questionFileId: 'qf-docx-1', question: 'Question 1', sectionId: 'sec-1' },
      { questionId: 'q2', questionFileId: 'qf-docx-1', question: 'Question 2', sectionId: 'sec-1' },
      { questionId: 'q3', questionFileId: 'qf-other', question: 'Question 3', sectionId: 'sec-1' },
    ];

    const allAnswers = {
      q1: { text: 'Answer 1', questionId: 'q1' },
      q2: { text: 'Answer 2', questionId: 'q2' },
      q3: { text: 'Answer 3', questionId: 'q3' },
    };

    mockLoadQuestions.mockResolvedValue(allQuestions);
    mockLoadAnswers.mockResolvedValue(allAnswers);
    mockGroupQuestions.mockReturnValue([
      {
        id: 'sec-1',
        title: 'Section 1',
        description: null,
        questions: [
          { id: 'q1', question: 'Question 1', answer: 'Answer 1' },
          { id: 'q2', question: 'Question 2', answer: 'Answer 2' },
        ],
      },
    ]);
    mockBuildSectionsHtml.mockReturnValue('<div>Sections HTML</div>');

    await generateHtmlQuestionnaireDocument(baseParams);

    // Should only load questions for qf-docx-1
    expect(mockGroupQuestions).toHaveBeenCalledWith(
      [allQuestions[0], allQuestions[1]], // Only questions from qf-docx-1
      { q1: allAnswers.q1, q2: allAnswers.q2 } // Only matching answers
    );

    // Should upload HTML to S3
    expect(mockUploadRFPDocumentHtml).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      documentId: 'mock-doc-id',
      html: expect.stringContaining('Sections HTML'),
    });

    // Should create document with S3 key
    expect(mockPutRFPDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        PK: 'RFP_DOCUMENT',
        SK: 'proj-1#opp-1#mock-doc-id',
        documentId: 'mock-doc-id',
        projectId: 'proj-1',
        opportunityId: 'opp-1',
        orgId: 'org-1',
        name: 'vendor-form-responses',
        documentType: 'QUESTIONNAIRE',
        htmlContentKey: 's3-key-mock-doc-id.html',
        version: 1,
        status: 'READY',
      })
    );
  });

  it('should skip when no questions found for questionFileId', async () => {
    mockLoadQuestions.mockResolvedValue([
      { questionId: 'q1', questionFileId: 'qf-other', question: 'Question 1' },
    ]);

    await generateHtmlQuestionnaireDocument(baseParams);

    expect(mockLoadAnswers).not.toHaveBeenCalled();
    expect(mockPutRFPDocument).not.toHaveBeenCalled();
  });

  it('should skip when no answers found for questions', async () => {
    mockLoadQuestions.mockResolvedValue([
      { questionId: 'q1', questionFileId: 'qf-docx-1', question: 'Question 1' },
    ]);
    mockLoadAnswers.mockResolvedValue({});

    await generateHtmlQuestionnaireDocument(baseParams);

    expect(mockPutRFPDocument).not.toHaveBeenCalled();
  });

  it('should name output based on originalFileName', async () => {
    mockLoadQuestions.mockResolvedValue([
      { questionId: 'q1', questionFileId: 'qf-docx-1', question: 'Question 1', sectionId: 'sec-1' },
    ]);
    mockLoadAnswers.mockResolvedValue({ q1: { text: 'Answer 1', questionId: 'q1' } });
    mockGroupQuestions.mockReturnValue([{ id: 'sec-1', title: 'Section 1', questions: [{ id: 'q1', question: 'Q1', answer: 'A1' }] }]);
    mockBuildSectionsHtml.mockReturnValue('<div>HTML</div>');

    await generateHtmlQuestionnaireDocument({
      ...baseParams,
      originalFileName: 'rfp-questions.pdf',
    });

    expect(mockPutRFPDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'rfp-questions-responses', // .pdf removed
      })
    );
  });

  it('should use default name when originalFileName not provided', async () => {
    mockLoadQuestions.mockResolvedValue([
      { questionId: 'q1', questionFileId: 'qf-docx-1', question: 'Question 1', sectionId: 'sec-1' },
    ]);
    mockLoadAnswers.mockResolvedValue({ q1: { text: 'Answer 1', questionId: 'q1' } });
    mockGroupQuestions.mockReturnValue([{ id: 'sec-1', title: 'Section 1', questions: [{ id: 'q1', question: 'Q1', answer: 'A1' }] }]);
    mockBuildSectionsHtml.mockReturnValue('<div>HTML</div>');

    await generateHtmlQuestionnaireDocument({
      ...baseParams,
      originalFileName: undefined,
    });

    expect(mockPutRFPDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Questionnaire Responses',
      })
    );
  });

  it('should handle multiple questionnaire files independently', async () => {
    // Simulate two separate calls for two different files
    const file1Questions = [
      { questionId: 'q1', questionFileId: 'qf-1', question: 'Q1', sectionId: 'sec-1' },
    ];
    const file2Questions = [
      { questionId: 'q2', questionFileId: 'qf-2', question: 'Q2', sectionId: 'sec-1' },
    ];

    // First file
    mockLoadQuestions.mockResolvedValue([...file1Questions, ...file2Questions]);
    mockLoadAnswers.mockResolvedValue({ q1: { text: 'A1' }, q2: { text: 'A2' } });
    mockGroupQuestions.mockReturnValue([{ id: 'sec-1', title: 'Section 1', questions: [{ id: 'q1', question: 'Q1', answer: 'A1' }] }]);
    mockBuildSectionsHtml.mockReturnValue('<div>HTML 1</div>');

    await generateHtmlQuestionnaireDocument({
      ...baseParams,
      questionFileId: 'qf-1',
      originalFileName: 'file1.docx',
    });

    expect(mockGroupQuestions).toHaveBeenCalledWith(
      file1Questions, // Only qf-1 questions
      { q1: { text: 'A1' } }
    );

    // Second file
    jest.clearAllMocks();
    mockLoadQuestions.mockResolvedValue([...file1Questions, ...file2Questions]);
    mockLoadAnswers.mockResolvedValue({ q1: { text: 'A1' }, q2: { text: 'A2' } });
    mockGroupQuestions.mockReturnValue([{ id: 'sec-1', title: 'Section 1', questions: [{ id: 'q2', question: 'Q2', answer: 'A2' }] }]);
    mockBuildSectionsHtml.mockReturnValue('<div>HTML 2</div>');

    await generateHtmlQuestionnaireDocument({
      ...baseParams,
      questionFileId: 'qf-2',
      originalFileName: 'file2.pdf',
    });

    expect(mockGroupQuestions).toHaveBeenCalledWith(
      file2Questions, // Only qf-2 questions
      { q2: { text: 'A2' } }
    );

    // Two separate documents should be created
    expect(mockPutRFPDocument).toHaveBeenCalledTimes(1);
  });
});
