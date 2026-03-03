import { z } from 'zod';

// ─── Clustering Thresholds ───

export const CLUSTERING_THRESHOLDS = {
  /** Questions with similarity >= 90% are auto-clustered and answers are copied */
  CLUSTER_THRESHOLD: 0.90,
  /** Questions with similarity >= 80% are shown as "similar" for reference */
  SIMILAR_THRESHOLD: 0.80,
  /** Maximum questions to return when finding similar questions */
  MAX_SIMILAR_QUESTIONS: 20,
} as const;

// ─── Cluster Member ───

export const ClusterMemberSchema = z.object({
  questionId: z.string().min(1),
  questionText: z.string().min(1),
  sectionId: z.string().optional(),
  sectionTitle: z.string().optional(),
  similarity: z.number().min(0).max(1),
  hasAnswer: z.boolean(),
  answerPreview: z.string().optional(),
});

export type ClusterMember = z.infer<typeof ClusterMemberSchema>;

// ─── Question Cluster ───

export const QuestionClusterSchema = z.object({
  clusterId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().optional(),
  masterQuestionId: z.string().min(1),
  masterQuestionText: z.string().min(1),
  members: z.array(ClusterMemberSchema),
  avgSimilarity: z.number().min(0).max(1),
  questionCount: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type QuestionCluster = z.infer<typeof QuestionClusterSchema>;

// ─── Similar Question (for display, not necessarily in same cluster) ───

export const SimilarQuestionSchema = z.object({
  questionId: z.string().min(1),
  questionText: z.string().min(1),
  sectionId: z.string().optional(),
  sectionTitle: z.string().optional(),
  similarity: z.number().min(0).max(1),
  hasAnswer: z.boolean(),
  answerPreview: z.string().optional(),
  inSameCluster: z.boolean(),
  clusterId: z.string().optional(),
});

export type SimilarQuestion = z.infer<typeof SimilarQuestionSchema>;

// ─── API Request/Response Schemas ───

export const ClusterQuestionsRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().optional(),
  questionFileId: z.string().optional(),
  forceRecluster: z.boolean().optional(),
});

export type ClusterQuestionsRequest = z.infer<typeof ClusterQuestionsRequestSchema>;

export const ClusterQuestionsResponseSchema = z.object({
  projectId: z.string(),
  clustersCreated: z.number(),
  questionsProcessed: z.number(),
  clusters: z.array(QuestionClusterSchema),
});

export type ClusterQuestionsResponse = z.infer<typeof ClusterQuestionsResponseSchema>;

export const GetClustersRequestSchema = z.object({
  projectId: z.string().min(1),
});

export type GetClustersRequest = z.infer<typeof GetClustersRequestSchema>;

export const GetClustersResponseSchema = z.object({
  projectId: z.string(),
  clusters: z.array(QuestionClusterSchema),
  totalClusters: z.number(),
});

export type GetClustersResponse = z.infer<typeof GetClustersResponseSchema>;

export const FindSimilarQuestionsRequestSchema = z.object({
  projectId: z.string().min(1),
  questionId: z.string().min(1),
  threshold: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(50).optional(),
});

export type FindSimilarQuestionsRequest = z.infer<typeof FindSimilarQuestionsRequestSchema>;

export const FindSimilarQuestionsResponseSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  similarQuestions: z.array(SimilarQuestionSchema),
});

export type FindSimilarQuestionsResponse = z.infer<typeof FindSimilarQuestionsResponseSchema>;

export const ApplyClusterAnswerRequestSchema = z.object({
  projectId: z.string().min(1),
  sourceQuestionId: z.string().min(1),
  targetQuestionIds: z.array(z.string().min(1)).min(1),
  customText: z.string().optional(),
});

export type ApplyClusterAnswerRequest = z.infer<typeof ApplyClusterAnswerRequestSchema>;

export const ApplyClusterAnswerResponseSchema = z.object({
  sourceQuestionId: z.string(),
  applied: z.array(z.string()),
  failed: z.array(z.object({
    questionId: z.string(),
    reason: z.string(),
  })),
});

export type ApplyClusterAnswerResponse = z.infer<typeof ApplyClusterAnswerResponseSchema>;

// ─── Pipeline Event Types ───

export interface QuestionWithEmbedding {
  questionId: string;
  projectId: string;
  opportunityId?: string;
  orgId: string;
  questionText: string;
  sectionId?: string;
  sectionTitle?: string;
  embedding?: number[];
}

export interface ClusteringResult {
  clusters: QuestionCluster[];
  masterQuestionIds: string[];
  nonMasterQuestionIds: string[];
  questionsProcessed: number;
}

export interface QuestionForAnswerWithCluster {
  questionId: string;
  projectId: string;
  opportunityId?: string;
  orgId: string;
  questionText: string;
  clusterId?: string;
  isClusterMaster?: boolean;
  masterQuestionId?: string;
  similarityToMaster?: number;
}
