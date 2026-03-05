import { describe, it, expect } from 'vitest';
import {
  CLUSTERING_THRESHOLDS,
  ClusterMemberSchema,
  QuestionClusterSchema,
  SimilarQuestionSchema,
  ClusterQuestionsRequestSchema,
  ClusterQuestionsResponseSchema,
  GetClustersRequestSchema,
  GetClustersResponseSchema,
  FindSimilarQuestionsRequestSchema,
  FindSimilarQuestionsResponseSchema,
  ApplyClusterAnswerRequestSchema,
  ApplyClusterAnswerResponseSchema,
} from './clustering';

// ─── CLUSTERING_THRESHOLDS ───

describe('CLUSTERING_THRESHOLDS', () => {
  it('has correct default values', () => {
    expect(CLUSTERING_THRESHOLDS.CLUSTER_THRESHOLD).toBe(0.80);
    expect(CLUSTERING_THRESHOLDS.SIMILAR_THRESHOLD).toBe(0.50);
    expect(CLUSTERING_THRESHOLDS.MAX_SIMILAR_QUESTIONS).toBe(20);
    expect(CLUSTERING_THRESHOLDS.MAX_QUESTIONS_TO_CLUSTER).toBe(500);
  });

  it('CLUSTER_THRESHOLD is greater than SIMILAR_THRESHOLD', () => {
    expect(CLUSTERING_THRESHOLDS.CLUSTER_THRESHOLD).toBeGreaterThan(CLUSTERING_THRESHOLDS.SIMILAR_THRESHOLD);
  });
});

// ─── ClusterMemberSchema ───

describe('ClusterMemberSchema', () => {
  const validMember = {
    questionId: 'q-123',
    questionText: 'What is the project timeline?',
    similarity: 0.85,
    hasAnswer: true,
  };

  it('accepts valid cluster member', () => {
    const result = ClusterMemberSchema.safeParse(validMember);
    expect(result.success).toBe(true);
  });

  it('accepts member with optional fields', () => {
    const result = ClusterMemberSchema.safeParse({
      ...validMember,
      sectionId: 'sec-1',
      sectionTitle: 'Technical Approach',
      answerPreview: 'The project timeline is...',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty questionId', () => {
    const result = ClusterMemberSchema.safeParse({ ...validMember, questionId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects similarity out of range', () => {
    expect(ClusterMemberSchema.safeParse({ ...validMember, similarity: 1.5 }).success).toBe(false);
    expect(ClusterMemberSchema.safeParse({ ...validMember, similarity: -0.1 }).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(ClusterMemberSchema.safeParse({ questionId: 'q-1' }).success).toBe(false);
  });
});

// ─── QuestionClusterSchema ───

describe('QuestionClusterSchema', () => {
  const validCluster = {
    clusterId: 'cluster-1',
    projectId: 'proj-1',
    masterQuestionId: 'q-master',
    masterQuestionText: 'What is the project timeline?',
    members: [
      { questionId: 'q-1', questionText: 'Timeline?', similarity: 0.9, hasAnswer: false },
    ],
    avgSimilarity: 0.9,
    questionCount: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('accepts valid cluster', () => {
    const result = QuestionClusterSchema.safeParse(validCluster);
    expect(result.success).toBe(true);
  });

  it('accepts cluster with optional fields', () => {
    const result = QuestionClusterSchema.safeParse({
      ...validCluster,
      opportunityId: 'opp-1',
      questionFileId: 'file-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty clusterId', () => {
    const result = QuestionClusterSchema.safeParse({ ...validCluster, clusterId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive questionCount', () => {
    const result = QuestionClusterSchema.safeParse({ ...validCluster, questionCount: 0 });
    expect(result.success).toBe(false);
  });
});

// ─── SimilarQuestionSchema ───

describe('SimilarQuestionSchema', () => {
  const validSimilar = {
    questionId: 'q-1',
    questionText: 'What is the budget?',
    similarity: 0.75,
    hasAnswer: false,
    inSameCluster: true,
  };

  it('accepts valid similar question', () => {
    const result = SimilarQuestionSchema.safeParse(validSimilar);
    expect(result.success).toBe(true);
  });

  it('accepts with optional fields', () => {
    const result = SimilarQuestionSchema.safeParse({
      ...validSimilar,
      sectionId: 'sec-1',
      sectionTitle: 'Budget',
      answerPreview: 'The budget is...',
      clusterId: 'cluster-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing inSameCluster', () => {
    const { inSameCluster, ...withoutField } = validSimilar;
    const result = SimilarQuestionSchema.safeParse(withoutField);
    expect(result.success).toBe(false);
  });
});

// ─── API Request Schemas ───

describe('ClusterQuestionsRequestSchema', () => {
  it('accepts valid request', () => {
    const result = ClusterQuestionsRequestSchema.safeParse({ projectId: 'proj-1' });
    expect(result.success).toBe(true);
  });

  it('accepts with optional fields', () => {
    const result = ClusterQuestionsRequestSchema.safeParse({
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      questionFileId: 'file-1',
      forceRecluster: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty projectId', () => {
    const result = ClusterQuestionsRequestSchema.safeParse({ projectId: '' });
    expect(result.success).toBe(false);
  });
});

describe('GetClustersRequestSchema', () => {
  it('accepts valid request', () => {
    const result = GetClustersRequestSchema.safeParse({ projectId: 'proj-1' });
    expect(result.success).toBe(true);
  });

  it('rejects empty projectId', () => {
    const result = GetClustersRequestSchema.safeParse({ projectId: '' });
    expect(result.success).toBe(false);
  });
});

describe('FindSimilarQuestionsRequestSchema', () => {
  it('accepts valid request', () => {
    const result = FindSimilarQuestionsRequestSchema.safeParse({
      projectId: 'proj-1',
      questionId: 'q-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with optional threshold and limit', () => {
    const result = FindSimilarQuestionsRequestSchema.safeParse({
      projectId: 'proj-1',
      questionId: 'q-1',
      threshold: 0.7,
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it('rejects threshold out of range', () => {
    expect(FindSimilarQuestionsRequestSchema.safeParse({
      projectId: 'proj-1', questionId: 'q-1', threshold: 1.5,
    }).success).toBe(false);
  });

  it('rejects limit exceeding max', () => {
    expect(FindSimilarQuestionsRequestSchema.safeParse({
      projectId: 'proj-1', questionId: 'q-1', limit: 51,
    }).success).toBe(false);
  });

  it('rejects non-positive limit', () => {
    expect(FindSimilarQuestionsRequestSchema.safeParse({
      projectId: 'proj-1', questionId: 'q-1', limit: 0,
    }).success).toBe(false);
  });
});

describe('ApplyClusterAnswerRequestSchema', () => {
  const validRequest = {
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    sourceQuestionId: 'q-source',
    targetQuestionIds: ['q-target-1', 'q-target-2'],
  };

  it('accepts valid request', () => {
    const result = ApplyClusterAnswerRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('accepts with optional fields', () => {
    const result = ApplyClusterAnswerRequestSchema.safeParse({
      ...validRequest,
      questionFileId: 'file-1',
      customText: 'Custom answer text',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty targetQuestionIds', () => {
    const result = ApplyClusterAnswerRequestSchema.safeParse({
      ...validRequest,
      targetQuestionIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing opportunityId', () => {
    const { opportunityId, ...withoutOpp } = validRequest;
    const result = ApplyClusterAnswerRequestSchema.safeParse(withoutOpp);
    expect(result.success).toBe(false);
  });

  it('rejects empty opportunityId', () => {
    const result = ApplyClusterAnswerRequestSchema.safeParse({
      ...validRequest,
      opportunityId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing orgId', () => {
    const { orgId, ...withoutOrg } = validRequest;
    const result = ApplyClusterAnswerRequestSchema.safeParse(withoutOrg);
    expect(result.success).toBe(false);
  });

  it('rejects empty orgId', () => {
    const result = ApplyClusterAnswerRequestSchema.safeParse({
      ...validRequest,
      orgId: '',
    });
    expect(result.success).toBe(false);
  });
});

// ─── API Response Schemas ───

describe('GetClustersResponseSchema', () => {
  it('accepts valid response', () => {
    const result = GetClustersResponseSchema.safeParse({
      projectId: 'proj-1',
      clusters: [],
      totalClusters: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe('FindSimilarQuestionsResponseSchema', () => {
  it('accepts valid response', () => {
    const result = FindSimilarQuestionsResponseSchema.safeParse({
      questionId: 'q-1',
      questionText: 'What is the timeline?',
      similarQuestions: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts response with threshold and limit', () => {
    const result = FindSimilarQuestionsResponseSchema.safeParse({
      questionId: 'q-1',
      questionText: 'What is the timeline?',
      similarQuestions: [],
      threshold: 0.7,
      limit: 10,
    });
    expect(result.success).toBe(true);
  });
});

describe('ApplyClusterAnswerResponseSchema', () => {
  it('accepts valid response with applied and failed', () => {
    const result = ApplyClusterAnswerResponseSchema.safeParse({
      sourceQuestionId: 'q-source',
      applied: ['q-1', 'q-2'],
      failed: [{ questionId: 'q-3', reason: 'Not found' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty arrays', () => {
    const result = ApplyClusterAnswerResponseSchema.safeParse({
      sourceQuestionId: 'q-source',
      applied: [],
      failed: [],
    });
    expect(result.success).toBe(true);
  });
});
