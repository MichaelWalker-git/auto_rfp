// ─── Prepare-Questions Pipeline Types ───

export interface PrepareQuestionsEvent {
  projectId: string;
  orgId?: string; // Passed from SF, but we also look it up from project
  opportunityId: string; // Required — scopes question fetching to a single opportunity
}

export interface QuestionForAnswerGeneration {
  questionId: string;
  projectId: string;
  orgId: string;
  questionText: string;
  sectionId?: string;
  sectionTitle?: string;
  opportunityId?: string;
  questionFileId?: string;
  // Clustering fields
  clusterId?: string;
  isClusterMaster?: boolean;
  masterQuestionId?: string;
  similarityToMaster?: number;
}

export interface QuestionWithEmbedding extends QuestionForAnswerGeneration {
  embedding?: number[];
}

// Minimal question reference for Step Functions (to avoid 256KB payload limit)
// Use explicit null (not undefined) so JSON.stringify includes the field
export interface QuestionReference {
  questionId: string;
  projectId: string;
  orgId: string;
  opportunityId: string | null;
  questionFileId: string | null;
  isClusterMaster: boolean | null;
  masterQuestionId: string | null;
}

export interface PrepareQuestionsResult {
  s3Bucket: string; // S3 bucket containing the questions JSONL file
  s3Key: string; // S3 key for the questions JSONL file (one JSON object per line)
  totalCount: number;
  projectId: string;
  orgId: string;
  clustersCreated: number;
  mastersCount: number;
  unclusteredCount: number;
  membersCount: number;
}

export interface ClusterAndSortResult {
  questions: QuestionForAnswerGeneration[];
  clustersCreated: number;
}

export interface MatchToExistingClustersResult {
  matched: QuestionForAnswerGeneration[];
  orphans: QuestionWithEmbedding[];
  matchedCount: number;
}

export interface FetchedQuestions {
  allQuestions: QuestionForAnswerGeneration[];
  alreadyClusteredQuestions: QuestionForAnswerGeneration[];
  newQuestions: QuestionForAnswerGeneration[];
}
