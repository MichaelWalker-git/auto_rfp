/**
 * Unit tests for prepare-questions Lambda
 * 
 * Tests the incremental clustering logic that:
 * 1. Preserves existing cluster assignments
 * 2. Matches new questions to existing clusters
 * 3. Creates new clusters from remaining orphans
 */

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

jest.mock('../helpers/env', () => ({
  requireEnv: jest.fn((name: string) => {
    const envMap: Record<string, string> = {
      DB_TABLE_NAME: 'test-table',
      PINECONE_INDEX: 'test-index',
    };
    return envMap[name] || `mock-${name}`;
  }),
}));

jest.mock('../helpers/db', () => ({
  docClient: {
    send: jest.fn(),
  },
}));

jest.mock('../helpers/project', () => ({
  getProjectById: jest.fn(),
}));

jest.mock('../organization/get-organization-by-id', () => ({
  getOrganizationById: jest.fn(),
}));

jest.mock('../helpers/embeddings', () => ({
  getEmbedding: jest.fn(),
}));

jest.mock('../helpers/pinecone', () => ({
  getPineconeClient: jest.fn(() => ({
    Index: jest.fn(() => ({
      namespace: jest.fn(() => ({
        upsert: jest.fn(),
        query: jest.fn(() => Promise.resolve({ matches: [] })),
      })),
    })),
  })),
}));

jest.mock('../sentry-lambda', () => ({
  withSentryLambda: (fn: any) => fn,
}));

import { baseHandler, PrepareQuestionsEvent } from './prepare-questions';

describe('prepare-questions Lambda', () => {
  const mockContext = {
    functionName: 'test',
    memoryLimitInMB: '128',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    awsRequestId: 'request-123',
    getRemainingTimeInMillis: () => 30000,
  } as any;

  const validEvent: PrepareQuestionsEvent = {
    projectId: 'proj-123',
  };

  const { docClient } = require('../helpers/db');
  const { getProjectById } = require('../helpers/project');
  const { getOrganizationById } = require('../organization/get-organization-by-id');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    it('should throw when projectId is missing', async () => {
      const event = {} as any;

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'projectId is required'
      );
    });

    it('should throw when projectId is empty string', async () => {
      const event: PrepareQuestionsEvent = { projectId: '' };

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'projectId is required'
      );
    });
  });

  describe('Project Validation', () => {
    it('should throw when project is not found', async () => {
      getProjectById.mockResolvedValueOnce(null);

      await expect(baseHandler(validEvent, mockContext)).rejects.toThrow(
        'Project not found: proj-123'
      );
    });

    it('should throw when project has no orgId', async () => {
      getProjectById.mockResolvedValueOnce({ id: 'proj-123', name: 'Test Project' });

      await expect(baseHandler(validEvent, mockContext)).rejects.toThrow(
        'Project proj-123 has no orgId'
      );
    });
  });

  describe('Question Retrieval', () => {
    beforeEach(() => {
      getProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-789' });
      getOrganizationById.mockResolvedValue({ id: 'org-789', clusterThreshold: 0.5 });
    });

    it('should return empty array when no questions exist', async () => {
      docClient.send.mockResolvedValueOnce({ Items: [] });

      const result = await baseHandler(validEvent, mockContext);

      expect(result).toEqual({
        questions: [],
        totalCount: 0,
        projectId: 'proj-123',
        orgId: 'org-789',
        clustersCreated: 0,
      });
    });

    it('should return single question without clustering', async () => {
      docClient.send.mockResolvedValueOnce({
        Items: [
          { questionId: 'q-1', question: 'Question 1' },
        ],
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(1);
      expect(result.questions).toHaveLength(1);
      expect(result.clustersCreated).toBe(0);
      
      const firstQuestion = result.questions[0];
      expect(firstQuestion).toBeDefined();
      expect(firstQuestion?.questionId).toBe('q-1');
      expect(firstQuestion?.projectId).toBe('proj-123');
      expect(firstQuestion?.orgId).toBe('org-789');
      expect(firstQuestion?.questionText).toBe('Question 1');
    });

    it('should skip items without questionId or question text', async () => {
      docClient.send.mockResolvedValueOnce({
        Items: [
          { questionId: 'q-1', question: 'Question 1' },
          { questionId: null, question: 'Missing ID' },
          { questionId: 'q-3', question: null },
          { questionId: 'q-4', question: '' },
        ],
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(1);
      expect(result.questions).toHaveLength(1);
      
      const onlyQuestion = result.questions[0];
      expect(onlyQuestion).toBeDefined();
      expect(onlyQuestion?.questionId).toBe('q-1');
    });

    it('should handle pagination with LastEvaluatedKey', async () => {
      // First page
      docClient.send
        .mockResolvedValueOnce({
          Items: [
            { questionId: 'q-1', question: 'Question 1' },
          ],
          LastEvaluatedKey: { pk: 'QUESTION', sk: 'proj-123#q-1' },
        })
        // Second page
        .mockResolvedValueOnce({
          Items: [],
        });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(1);
      expect(docClient.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cluster Preservation', () => {
    beforeEach(() => {
      getProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-789' });
      getOrganizationById.mockResolvedValue({ id: 'org-789', clusterThreshold: 0.5 });
    });

    it('should preserve already-clustered questions without re-embedding', async () => {
      docClient.send.mockResolvedValueOnce({
        Items: [
          { 
            questionId: 'q-master', 
            question: 'Master Question',
            clusterId: 'cluster-123',
            isClusterMaster: true,
            similarityToMaster: 1.0,
          },
          { 
            questionId: 'q-member', 
            question: 'Member Question',
            clusterId: 'cluster-123',
            isClusterMaster: false,
            linkedToMasterQuestionId: 'q-master',
            similarityToMaster: 0.85,
          },
        ],
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(2);
      expect(result.clustersCreated).toBe(0); // No new clusters
      
      // Verify cluster info preserved
      const master = result.questions.find(q => q.questionId === 'q-master');
      const member = result.questions.find(q => q.questionId === 'q-member');
      
      expect(master?.clusterId).toBe('cluster-123');
      expect(master?.isClusterMaster).toBe(true);
      expect(member?.clusterId).toBe('cluster-123');
      expect(member?.isClusterMaster).toBe(false);
      expect(member?.masterQuestionId).toBe('q-master');
    });

    it('should order masters first, then unclustered, then members', async () => {
      docClient.send.mockResolvedValueOnce({
        Items: [
          { questionId: 'q-member', question: 'Member Question', clusterId: 'c1', isClusterMaster: false, linkedToMasterQuestionId: 'q-master' },
          { questionId: 'q-unclustered', question: 'Unclustered Question' },
          { questionId: 'q-master', question: 'Master Question Long Text', clusterId: 'c1', isClusterMaster: true },
        ],
      });

      const result = await baseHandler(validEvent, mockContext);

      // Should be sorted: masters, unclustered, members
      expect(result.questions[0]?.questionId).toBe('q-master');
      expect(result.questions[1]?.questionId).toBe('q-unclustered');
      expect(result.questions[2]?.questionId).toBe('q-member');
    });
  });

  describe('Organization Settings', () => {
    beforeEach(() => {
      getProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-789' });
    });

    it('should use default threshold when org has no clusterThreshold', async () => {
      getOrganizationById.mockResolvedValue({ id: 'org-789' }); // No clusterThreshold

      docClient.send.mockResolvedValueOnce({
        Items: [{ questionId: 'q-1', question: 'Question 1' }],
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(1);
      // Function should complete without error using default
    });

    it('should handle org lookup failure gracefully', async () => {
      getOrganizationById.mockRejectedValue(new Error('DB error'));

      docClient.send.mockResolvedValueOnce({
        Items: [{ questionId: 'q-1', question: 'Question 1' }],
      });

      // Should not throw, uses default threshold
      const result = await baseHandler(validEvent, mockContext);
      expect(result.totalCount).toBe(1);
    });
  });
});