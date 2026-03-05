// Mock middy before importing
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234'),
}));

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

// Mock rfp-document helper (imported by proposal-submission)
const mockListRFPDocumentsByProject = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  listRFPDocumentsByProject: (...args: unknown[]) => mockListRFPDocumentsByProject(...args),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import {
  buildSubmissionSk,
  buildSubmissionSkPrefix,
  createSubmissionRecord,
  getSubmissionHistory,
  withdrawSubmissionRecord,
  checkSubmissionReadiness,
} from './proposal-submission';

// ─── SK Builders ──────────────────────────────────────────────────────────────

describe('buildSubmissionSk', () => {
  it('produces correct format', () => {
    const sk = buildSubmissionSk('org-1', 'proj-2', 'opp-3', 'sub-4');
    expect(sk).toBe('org-1#proj-2#opp-3#sub-4');
  });

  it('handles IDs with special characters', () => {
    const sk = buildSubmissionSk('org-abc', 'proj-xyz', 'opp-123', 'uuid-456');
    expect(sk).toBe('org-abc#proj-xyz#opp-123#uuid-456');
  });
});

describe('buildSubmissionSkPrefix', () => {
  it('produces correct prefix with trailing #', () => {
    const prefix = buildSubmissionSkPrefix('org-1', 'proj-2', 'opp-3');
    expect(prefix).toBe('org-1#proj-2#opp-3#');
  });
});

// ─── createSubmissionRecord ───────────────────────────────────────────────────

describe('createSubmissionRecord', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('creates a SUBMITTED record with correct fields', async () => {
    mockSend.mockResolvedValueOnce({});

    const dto = {
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      submissionMethod: 'PORTAL' as const,
      forceSubmit: false,
    };

    const result = await createSubmissionRecord(dto, 'user-123', 'John Doe', ['doc-1', 'doc-2'], null);

    expect(result.submissionId).toBe('mock-uuid-1234');
    expect(result.status).toBe('SUBMITTED');
    expect(result.submissionMethod).toBe('PORTAL');
    expect(result.submittedBy).toBe('user-123');
    expect(result.submittedByName).toBe('John Doe');
    expect(result.documentIds).toEqual(['doc-1', 'doc-2']);
    expect(result.orgId).toBe('org-1');
    expect(result.projectId).toBe('proj-1');
    expect(result.oppId).toBe('opp-1');
  });

  it('stores record with correct PK and SK', async () => {
    mockSend.mockResolvedValueOnce({});

    const dto = {
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      submissionMethod: 'EMAIL' as const,
      forceSubmit: false,
    };

    await createSubmissionRecord(dto, 'user-123', undefined, [], null);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          TableName: 'test-table',
          Item: expect.objectContaining({
            partition_key: 'PROPOSAL_SUBMISSION',
            sort_key: 'org-1#proj-1#opp-1#mock-uuid-1234',
          }),
        }),
      }),
    );
  });

  it('includes optional fields when provided', async () => {
    mockSend.mockResolvedValueOnce({});

    const dto = {
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      submissionMethod: 'PORTAL' as const,
      submissionReference: 'SAM-2025-001',
      submissionNotes: 'Test notes',
      portalUrl: 'https://sam.gov/opp/123',
      forceSubmit: false,
    };

    const result = await createSubmissionRecord(dto, 'user-123', 'Jane', [], '2025-06-30T00:00:00Z');

    expect(result.submissionReference).toBe('SAM-2025-001');
    expect(result.submissionNotes).toBe('Test notes');
    expect(result.portalUrl).toBe('https://sam.gov/opp/123');
    expect(result.deadlineIso).toBe('2025-06-30T00:00:00Z');
  });
});

// ─── getSubmissionHistory ─────────────────────────────────────────────────────

describe('getSubmissionHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('returns empty array when no submissions exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await getSubmissionHistory('org-1', 'proj-1', 'opp-1');
    expect(result).toEqual([]);
  });

  it('returns submissions sorted by submittedAt descending', async () => {
    const older = {
      submissionId: 'sub-old',
      submittedAt: '2025-01-01T00:00:00Z',
      status: 'SUBMITTED',
    };
    const newer = {
      submissionId: 'sub-new',
      submittedAt: '2025-01-15T00:00:00Z',
      status: 'SUBMITTED',
    };
    mockSend.mockResolvedValueOnce({ Items: [older, newer] });

    const result = await getSubmissionHistory('org-1', 'proj-1', 'opp-1');
    expect(result[0]!.submissionId).toBe('sub-new');
    expect(result[1]!.submissionId).toBe('sub-old');
  });

  it('queries with correct SK prefix', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await getSubmissionHistory('org-1', 'proj-1', 'opp-1');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          TableName: 'test-table',
          ExpressionAttributeValues: expect.objectContaining({
            ':skPrefix': 'org-1#proj-1#opp-1#',
          }),
        }),
      }),
    );
  });
});

// ─── withdrawSubmissionRecord ─────────────────────────────────────────────────

describe('withdrawSubmissionRecord', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('updates the record to WITHDRAWN status', async () => {
    mockSend.mockResolvedValueOnce({});

    await withdrawSubmissionRecord('org-1', 'proj-1', 'opp-1', 'sub-123', 'user-456', 'Cancelled');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          TableName: 'test-table',
          Item: expect.objectContaining({
            partition_key: 'PROPOSAL_SUBMISSION',
            sort_key: 'org-1#proj-1#opp-1#sub-123',
            status: 'WITHDRAWN',
            withdrawnBy: 'user-456',
            withdrawalReason: 'Cancelled',
          }),
        }),
      }),
    );
  });

  it('works without a withdrawal reason', async () => {
    mockSend.mockResolvedValueOnce({});

    await withdrawSubmissionRecord('org-1', 'proj-1', 'opp-1', 'sub-123', 'user-456');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          Item: expect.objectContaining({
            status: 'WITHDRAWN',
            withdrawnBy: 'user-456',
          }),
        }),
      }),
    );
  });
});

// ─── checkSubmissionReadiness ─────────────────────────────────────────────────

describe('checkSubmissionReadiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  const makeReadinessArgs = (overrides: Partial<Parameters<typeof checkSubmissionReadiness>[0]> = {}) => ({
    orgId: 'org-1',
    projectId: 'proj-1',
    oppId: 'opp-1',
    currentStage: 'PURSUING',
    deadlineIso: null,
    ...overrides,
  });

  const mockQuestionsAndAnswers = (
    questions: Array<{ questionId: string }>,
    answers: Array<{ questionId: string; text: string; status: string }>,
    docs: unknown[] = [],
    existingSubmissions: unknown[] = [],
  ) => {
    // 1. listQuestionsForOpportunity (QueryCommand via docClient)
    mockSend.mockResolvedValueOnce({ Items: questions });
    // 2. listAnswersForOpportunity (QueryCommand via docClient)
    if (questions.length > 0) {
      mockSend.mockResolvedValueOnce({ Items: answers });
    }
    // 3. listRFPDocumentsByProject — mocked at module level
    mockListRFPDocumentsByProject.mockResolvedValueOnce({ items: docs });
    // 4. queryBySkPrefix for existing submissions (QueryCommand via docClient)
    mockSend.mockResolvedValueOnce({ Items: existingSubmissions });
  };

  it('returns ready=false when stage is not PURSUING', async () => {
    mockQuestionsAndAnswers([], [], [], []);

    const result = await checkSubmissionReadiness(makeReadinessArgs({ currentStage: 'IDENTIFIED' }));

    expect(result.ready).toBe(false);
    const stageCheck = result.checks.find((c) => c.id === 'opportunity_stage');
    expect(stageCheck?.passed).toBe(false);
    expect(stageCheck?.blocking).toBe(true);
    expect(stageCheck?.detail).toContain('IDENTIFIED');
  });

  it('returns ready=false when no questions exist', async () => {
    mockQuestionsAndAnswers([], [], [], []);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    const questionsCheck = result.checks.find((c) => c.id === 'questions_exist');
    expect(questionsCheck?.passed).toBe(false);
    expect(questionsCheck?.blocking).toBe(true);
  });

  it('returns ready=false when questions exist but some are unanswered', async () => {
    const questions = [{ questionId: 'q-1' }, { questionId: 'q-2' }];
    const answers = [{ questionId: 'q-1', text: 'Answer 1', status: 'APPROVED' }];
    mockQuestionsAndAnswers(questions, answers, [], []);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    const answeredCheck = result.checks.find((c) => c.id === 'all_questions_answered');
    expect(answeredCheck?.passed).toBe(false);
    expect(answeredCheck?.detail).toContain('1 question(s) still unanswered');
  });

  it('returns ready=false when answers are in DRAFT status', async () => {
    const questions = [{ questionId: 'q-1' }];
    const answers = [{ questionId: 'q-1', text: 'Draft answer', status: 'DRAFT' }];
    mockQuestionsAndAnswers(questions, answers, [], []);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    const approvedCheck = result.checks.find((c) => c.id === 'all_answers_approved');
    expect(approvedCheck?.passed).toBe(false);
    expect(approvedCheck?.detail).toContain('1 answer(s) still in DRAFT');
  });

  it('returns ready=false when required documents are missing', async () => {
    const questions = [{ questionId: 'q-1' }];
    const answers = [{ questionId: 'q-1', text: 'Answer', status: 'APPROVED' }];
    // No documents
    mockQuestionsAndAnswers(questions, answers, [], []);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    const docsCheck = result.checks.find((c) => c.id === 'required_documents');
    expect(docsCheck?.passed).toBe(false);
    expect(docsCheck?.detail).toContain('Technical Proposal');
    expect(docsCheck?.detail).toContain('Cost Proposal');
  });

  it('returns ready=false when documents are still generating', async () => {
    const questions = [{ questionId: 'q-1' }];
    const answers = [{ questionId: 'q-1', text: 'Answer', status: 'APPROVED' }];
    const docs = [
      { documentType: 'TECHNICAL_PROPOSAL', status: 'GENERATING', signatureStatus: 'NOT_REQUIRED', name: 'Tech Proposal' },
      { documentType: 'COST_PROPOSAL', status: 'READY', signatureStatus: 'FULLY_SIGNED', name: 'Cost Proposal' },
    ];
    mockQuestionsAndAnswers(questions, answers, docs, []);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    const generatingCheck = result.checks.find((c) => c.id === 'no_generating');
    expect(generatingCheck?.passed).toBe(false);
    expect(generatingCheck?.detail).toContain('Tech Proposal');
  });

  it('returns ready=false when documents have failed generation', async () => {
    const questions = [{ questionId: 'q-1' }];
    const answers = [{ questionId: 'q-1', text: 'Answer', status: 'APPROVED' }];
    const docs = [
      { documentType: 'TECHNICAL_PROPOSAL', status: 'FAILED', signatureStatus: 'NOT_REQUIRED', name: 'Tech Proposal' },
      { documentType: 'COST_PROPOSAL', status: 'READY', signatureStatus: 'FULLY_SIGNED', name: 'Cost Proposal' },
    ];
    mockQuestionsAndAnswers(questions, answers, docs, []);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    const failedCheck = result.checks.find((c) => c.id === 'no_failed_generation');
    expect(failedCheck?.passed).toBe(false);
  });

  it('returns ready=false when documents are not approved', async () => {
    const questions = [{ questionId: 'q-1' }];
    const answers = [{ questionId: 'q-1', text: 'Answer', status: 'APPROVED' }];
    const docs = [
      { documentType: 'TECHNICAL_PROPOSAL', status: 'READY', signatureStatus: 'PENDING_SIGNATURE', name: 'Tech Proposal' },
      { documentType: 'COST_PROPOSAL', status: 'READY', signatureStatus: 'FULLY_SIGNED', name: 'Cost Proposal' },
    ];
    mockQuestionsAndAnswers(questions, answers, docs, []);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    const approvedDocsCheck = result.checks.find((c) => c.id === 'documents_approved');
    expect(approvedDocsCheck?.passed).toBe(false);
    expect(approvedDocsCheck?.detail).toContain('1 document(s) not yet approved');
  });

  it('adds a non-blocking warning when deadline has passed', async () => {
    const questions = [{ questionId: 'q-1' }];
    const answers = [{ questionId: 'q-1', text: 'Answer', status: 'APPROVED' }];
    const docs = [
      { documentType: 'TECHNICAL_PROPOSAL', status: 'READY', signatureStatus: 'FULLY_SIGNED', name: 'Tech' },
      { documentType: 'COST_PROPOSAL', status: 'READY', signatureStatus: 'FULLY_SIGNED', name: 'Cost' },
    ];
    mockQuestionsAndAnswers(questions, answers, docs, []);

    const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = await checkSubmissionReadiness(makeReadinessArgs({ deadlineIso: pastDeadline }));

    const deadlineCheck = result.checks.find((c) => c.id === 'deadline_check');
    expect(deadlineCheck?.passed).toBe(false);
    expect(deadlineCheck?.blocking).toBe(false);
    expect(result.warningFails).toBeGreaterThanOrEqual(1);
  });

  it('adds a non-blocking warning when already submitted', async () => {
    const questions = [{ questionId: 'q-1' }];
    const answers = [{ questionId: 'q-1', text: 'Answer', status: 'APPROVED' }];
    const docs = [
      { documentType: 'TECHNICAL_PROPOSAL', status: 'READY', signatureStatus: 'FULLY_SIGNED', name: 'Tech' },
      { documentType: 'COST_PROPOSAL', status: 'READY', signatureStatus: 'FULLY_SIGNED', name: 'Cost' },
    ];
    const existingSubmissions = [
      { status: 'SUBMITTED', submittedAt: '2025-01-01T00:00:00Z' },
    ];
    mockQuestionsAndAnswers(questions, answers, docs, existingSubmissions);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    const alreadySubmittedCheck = result.checks.find((c) => c.id === 'not_already_submitted');
    expect(alreadySubmittedCheck?.passed).toBe(false);
    expect(alreadySubmittedCheck?.blocking).toBe(false);
  });

  it('returns ready=true when all blocking checks pass', async () => {
    const questions = [{ questionId: 'q-1' }];
    const answers = [{ questionId: 'q-1', text: 'Answer', status: 'APPROVED' }];
    const docs = [
      { documentType: 'TECHNICAL_PROPOSAL', status: 'READY', signatureStatus: 'FULLY_SIGNED', name: 'Tech' },
      { documentType: 'COST_PROPOSAL', status: 'READY', signatureStatus: 'NOT_REQUIRED', name: 'Cost' },
    ];
    mockQuestionsAndAnswers(questions, answers, docs, []);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    expect(result.ready).toBe(true);
    expect(result.blockingFails).toBe(0);
    expect(result.checks.every((c) => !c.blocking || c.passed)).toBe(true);
  });

  it('counts blockingFails and warningFails correctly', async () => {
    // Stage not PURSUING (1 blocking fail) + deadline passed (1 warning fail)
    mockQuestionsAndAnswers([], [], [], []);

    const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = await checkSubmissionReadiness(
      makeReadinessArgs({ currentStage: 'IDENTIFIED', deadlineIso: pastDeadline }),
    );

    expect(result.blockingFails).toBeGreaterThanOrEqual(1);
    expect(result.warningFails).toBeGreaterThanOrEqual(1);
    expect(result.ready).toBe(false);
  });

  it('ignores deleted documents in checks', async () => {
    const questions = [{ questionId: 'q-1' }];
    const answers = [{ questionId: 'q-1', text: 'Answer', status: 'APPROVED' }];
    const docs = [
      // Deleted doc — should be ignored
      { documentType: 'TECHNICAL_PROPOSAL', status: 'FAILED', signatureStatus: 'NOT_REQUIRED', name: 'Deleted Tech', deletedAt: '2025-01-01T00:00:00Z' },
      // Active docs
      { documentType: 'TECHNICAL_PROPOSAL', status: 'READY', signatureStatus: 'FULLY_SIGNED', name: 'Tech' },
      { documentType: 'COST_PROPOSAL', status: 'READY', signatureStatus: 'NOT_REQUIRED', name: 'Cost' },
    ];
    mockQuestionsAndAnswers(questions, answers, docs, []);

    const result = await checkSubmissionReadiness(makeReadinessArgs());

    // The deleted FAILED doc should not trigger the no_failed_generation check
    const failedCheck = result.checks.find((c) => c.id === 'no_failed_generation');
    expect(failedCheck?.passed).toBe(true);
  });
});
