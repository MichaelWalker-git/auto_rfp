/**
 * Unit tests for prepare-questions Lambda
 *
 * Tests the incremental clustering logic that:
 * 1. Preserves existing cluster assignments
 * 2. Matches new questions to existing clusters
 * 3. Creates new clusters from remaining orphans
 */

// ─── Mocks ───

jest.mock('@/helpers/env', () => ({
  requireEnv: jest.fn((name: string) => {
    const envMap: Record<string, string> = {
      DB_TABLE_NAME: 'test-table',
      PINECONE_INDEX: 'test-index',
      DOCUMENTS_BUCKET: 'test-bucket',
    };
    return envMap[name] || `mock-${name}`;
  }),
}));

jest.mock('@/helpers/project', () => ({
  getProjectById: jest.fn(),
}));

const mockFetchAllProjectQuestions = jest.fn();
const mockGetClusterThreshold = jest.fn();
jest.mock('@/helpers/prepare-questions-db', () => ({
  fetchAllProjectQuestions: mockFetchAllProjectQuestions,
  getClusterThreshold: mockGetClusterThreshold,
}));

const mockWriteQuestionsToS3 = jest.fn();
jest.mock('@/helpers/prepare-questions-s3', () => ({
  writeQuestionsToS3: mockWriteQuestionsToS3,
  getDocumentsBucket: jest.fn(() => 'test-bucket'),
}));

const mockRunClusteringPipeline = jest.fn();
jest.mock('@/helpers/pipeline-clustering', () => ({
  runClusteringPipeline: mockRunClusteringPipeline,
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

// ─── Imports ───

import { baseHandler, PrepareQuestionsEvent } from './prepare-questions';

// ─── Tests ───

describe('prepare-questions Lambda', () => {
  const mockContext = {
    functionName: 'test',
    memoryLimitInMB: '128',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    awsRequestId: 'request-123',
    getRemainingTimeInMillis: () => 30000,
  } as never;

  const validEvent: PrepareQuestionsEvent = { projectId: 'proj-123', opportunityId: 'opp-456' };

  const { getProjectById } = require('@/helpers/project');

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAllProjectQuestions.mockReset();
    mockGetClusterThreshold.mockResolvedValue(0.5);
    mockWriteQuestionsToS3.mockResolvedValue('answer-pipeline/proj-123/12345-questions.jsonl');
    mockRunClusteringPipeline.mockReset();
  });

  // ─── Input Validation ───

  describe('Input Validation', () => {
    it('should throw when projectId is missing', async () => {
      await expect(baseHandler({} as PrepareQuestionsEvent, mockContext)).rejects.toThrow('projectId is required');
    });

    it('should throw when projectId is empty string', async () => {
      await expect(baseHandler({ projectId: '', opportunityId: 'opp-1' } as PrepareQuestionsEvent, mockContext)).rejects.toThrow('projectId is required');
    });

    it('should throw when opportunityId is missing', async () => {
      await expect(baseHandler({ projectId: 'proj-123' } as PrepareQuestionsEvent, mockContext)).rejects.toThrow('opportunityId is required');
    });

    it('should throw when opportunityId is empty string', async () => {
      await expect(baseHandler({ projectId: 'proj-123', opportunityId: '' }, mockContext)).rejects.toThrow('opportunityId is required');
    });
  });

  // ─── Project Validation ───

  describe('Project Validation', () => {
    it('should throw when project is not found', async () => {
      getProjectById.mockImplementation(() => Promise.resolve(null));
      await expect(baseHandler(validEvent, mockContext)).rejects.toThrow('Project not found: proj-123');
    });

    it('should throw when project has no orgId', async () => {
      getProjectById.mockImplementation(() => Promise.resolve({ id: 'proj-123', name: 'Test Project' }));
      await expect(baseHandler(validEvent, mockContext)).rejects.toThrow('Project proj-123 has no orgId');
    });
  });

  // ─── Question Retrieval ───

  describe('Question Retrieval', () => {
    beforeEach(() => {
      getProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-789' });
    });

    it('should return S3 location when no questions exist', async () => {
      mockFetchAllProjectQuestions.mockResolvedValueOnce({
        allQuestions: [],
        alreadyClusteredQuestions: [],
        newQuestions: [],
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.s3Bucket).toBe('test-bucket');
      expect(result.totalCount).toBe(0);
      expect(result.projectId).toBe('proj-123');
      expect(result.orgId).toBe('org-789');
      expect(result.clustersCreated).toBe(0);
      expect(result.mastersCount).toBe(0);
      expect(result.unclusteredCount).toBe(0);
      expect(result.membersCount).toBe(0);
      expect(mockWriteQuestionsToS3).toHaveBeenCalledWith('proj-123', []);
      // Should NOT call clustering pipeline
      expect(mockRunClusteringPipeline).not.toHaveBeenCalled();
    });

    it('should return single question without clustering', async () => {
      const singleQuestion = { questionId: 'q-1', projectId: 'proj-123', orgId: 'org-789', questionText: 'Question 1' };
      mockFetchAllProjectQuestions.mockResolvedValueOnce({
        allQuestions: [singleQuestion],
        alreadyClusteredQuestions: [],
        newQuestions: [singleQuestion],
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(1);
      expect(result.clustersCreated).toBe(0);
      expect(result.unclusteredCount).toBe(1);
      expect(mockWriteQuestionsToS3).toHaveBeenCalledWith('proj-123', [singleQuestion]);
      expect(mockRunClusteringPipeline).not.toHaveBeenCalled();
    });
  });

  // ─── Clustering Pipeline ───

  describe('Clustering Pipeline', () => {
    beforeEach(() => {
      getProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-789' });
    });

    it('should call runClusteringPipeline when >= 2 questions', async () => {
      const q1 = { questionId: 'q-1', projectId: 'proj-123', orgId: 'org-789', questionText: 'Question 1' };
      const q2 = { questionId: 'q-2', projectId: 'proj-123', orgId: 'org-789', questionText: 'Question 2' };

      mockFetchAllProjectQuestions.mockResolvedValueOnce({
        allQuestions: [q1, q2],
        alreadyClusteredQuestions: [],
        newQuestions: [q1, q2],
      });

      mockRunClusteringPipeline.mockResolvedValueOnce({
        sortedQuestions: [q1, q2],
        clustersCreated: 0,
        mastersCount: 0,
        unclusteredCount: 2,
        membersCount: 0,
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(2);
      expect(mockRunClusteringPipeline).toHaveBeenCalledWith('proj-123', 'org-789', [], [q1, q2], 0.5);
      expect(mockWriteQuestionsToS3).toHaveBeenCalledWith('proj-123', [q1, q2]);
    });

    it('should preserve already-clustered questions', async () => {
      const master = { questionId: 'q-master', projectId: 'proj-123', orgId: 'org-789', questionText: 'Master Question', clusterId: 'c1', isClusterMaster: true };
      const member = { questionId: 'q-member', projectId: 'proj-123', orgId: 'org-789', questionText: 'Member Question', clusterId: 'c1', isClusterMaster: false, masterQuestionId: 'q-master' };

      mockFetchAllProjectQuestions.mockResolvedValueOnce({
        allQuestions: [master, member],
        alreadyClusteredQuestions: [master, member],
        newQuestions: [],
      });

      mockRunClusteringPipeline.mockResolvedValueOnce({
        sortedQuestions: [master, member],
        clustersCreated: 0,
        mastersCount: 1,
        unclusteredCount: 0,
        membersCount: 1,
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(2);
      expect(result.clustersCreated).toBe(0);
      expect(result.mastersCount).toBe(1);
      expect(result.membersCount).toBe(1);
      expect(mockRunClusteringPipeline).toHaveBeenCalledWith('proj-123', 'org-789', [master, member], [], 0.5);
    });

    it('should pass correct cluster threshold from org settings', async () => {
      const q1 = { questionId: 'q-1', projectId: 'proj-123', orgId: 'org-789', questionText: 'Q1' };
      const q2 = { questionId: 'q-2', projectId: 'proj-123', orgId: 'org-789', questionText: 'Q2' };

      mockFetchAllProjectQuestions.mockResolvedValueOnce({
        allQuestions: [q1, q2],
        alreadyClusteredQuestions: [],
        newQuestions: [q1, q2],
      });

      mockGetClusterThreshold.mockResolvedValueOnce(0.85);

      mockRunClusteringPipeline.mockResolvedValueOnce({
        sortedQuestions: [q1, q2],
        clustersCreated: 0,
        mastersCount: 0,
        unclusteredCount: 2,
        membersCount: 0,
      });

      await baseHandler(validEvent, mockContext);

      expect(mockGetClusterThreshold).toHaveBeenCalledWith('org-789');
      expect(mockRunClusteringPipeline).toHaveBeenCalledWith('proj-123', 'org-789', [], [q1, q2], 0.85);
    });
  });
});
