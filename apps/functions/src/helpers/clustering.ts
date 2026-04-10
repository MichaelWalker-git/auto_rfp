import { z } from 'zod';
import type { QuestionItem, AnswerItem } from '@auto-rfp/core';
import { getItem, queryBySkPrefix, type DBItem } from '@/helpers/db';
import { getEmbedding } from '@/helpers/embeddings';
import { initPineconeClient } from '@/helpers/pinecone';
import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { QUESTION_EMBEDDING_TYPE } from '@/constants/clustering';
import { buildQuestionSK } from '@/helpers/question';
import { buildAnswerSK } from '@/helpers/answer';

// ─── Types ───

export type QuestionDBItem = QuestionItem & DBItem;
export type AnswerDBItem = AnswerItem & DBItem;

// ─── Pinecone Metadata Validation ───

const PineconeQuestionMetadataSchema = z.object({
  questionId: z.string().optional(),
  questionText: z.string().optional(),
  sectionId: z.string().optional(),
  sectionTitle: z.string().optional(),
});

// Resolved lazily so Lambdas without this env var don't crash at cold-start
const getPineconeIndex = () => requireEnv('PINECONE_INDEX');

// ─── Question Helpers ───

/**
 * Get a question by ID. When fileId is provided, does a direct GetItem.
 * When fileId is missing, queries by prefix and finds by questionId.
 */
export const getQuestionById = async (
  projectId: string,
  opportunityId: string,
  fileId: string,
  questionId: string,
): Promise<QuestionDBItem | null> => {
  if (fileId) {
    return getItem<QuestionDBItem>(QUESTION_PK, buildQuestionSK(projectId, opportunityId, fileId, questionId));
  }

  const skPrefix = `${projectId}#${opportunityId}#`;
  const items = await queryBySkPrefix<QuestionDBItem>(QUESTION_PK, skPrefix);
  return items.find(
    (item) => item.questionId === questionId || item[SK_NAME]?.toString().endsWith(`#${questionId}`),
  ) ?? null;
};

/**
 * Get the answer for a question. When fileId is provided, does a direct GetItem.
 * When fileId is missing, queries by prefix and finds by questionId.
 */
export const getAnswerById = async (
  projectId: string,
  opportunityId: string,
  fileId: string,
  questionId: string,
): Promise<AnswerDBItem | null> => {
  if (fileId) {
    return getItem<AnswerDBItem>(ANSWER_PK, buildAnswerSK(projectId, opportunityId, fileId, questionId));
  }

  const skPrefix = `${projectId}#${opportunityId}#`;
  const items = await queryBySkPrefix<AnswerDBItem>(ANSWER_PK, skPrefix);
  return items.find(
    (item) => item.questionId === questionId || item[SK_NAME]?.toString().endsWith(`#${questionId}`),
  ) ?? null;
};

// ─── Batch Answer Check ───

/**
 * Check which question IDs have answers using a prefix query.
 * Returns a Set of questionIds that have non-empty answer text.
 * This avoids N+1 individual GetItem calls.
 */
export const batchCheckAnswers = async (
  projectId: string,
  opportunityId: string,
  fileId: string,
): Promise<Set<string>> => {
  const skPrefix = fileId
    ? `${projectId}#${opportunityId}#${fileId}#`
    : `${projectId}#${opportunityId}#`;

  const answers = await queryBySkPrefix<AnswerDBItem>(ANSWER_PK, skPrefix);

  const answeredIds = new Set<string>();
  for (const answer of answers) {
    if (answer.text && answer.questionId) {
      answeredIds.add(answer.questionId);
    }
  }
  return answeredIds;
};

// ─── Pinecone Similarity Search ───

export interface SimilarMatch {
  questionId: string;
  similarity: number;
  questionText?: string;
  sectionId?: string;
  sectionTitle?: string;
  fileId?: string;
}

/**
 * Find similar questions in Pinecone by embedding similarity.
 */
export const findSimilarInPinecone = async (
  orgId: string,
  projectId: string,
  questionText: string,
  excludeQuestionId: string,
  threshold: number,
  limit: number,
): Promise<SimilarMatch[]> => {
  const client = await initPineconeClient();
  const index = client.Index(getPineconeIndex());

  const embedding = await getEmbedding(questionText);

  const results = await index.namespace(orgId).query({
    vector: embedding,
    topK: limit + 5,
    includeMetadata: true,
    filter: {
      type: { $eq: QUESTION_EMBEDDING_TYPE },
      projectId: { $eq: projectId },
    },
  });

  const similar: SimilarMatch[] = [];

  for (const match of results.matches || []) {
    const score = match.score ?? 0;

    // Validate Pinecone metadata with Zod instead of unsafe casts
    const { success, data: metadata } = PineconeQuestionMetadataSchema.safeParse(match.metadata ?? {});
    const matchedQuestionId = success ? metadata.questionId : undefined;

    if (!matchedQuestionId || matchedQuestionId === excludeQuestionId || score < threshold) continue;

    similar.push({
      questionId: matchedQuestionId,
      similarity: score,
      questionText: success ? metadata.questionText : undefined,
      sectionId: success ? metadata.sectionId : undefined,
      sectionTitle: success ? metadata.sectionTitle : undefined,
    });

    if (similar.length >= limit) break;
  }

  return similar;
};

// ─── Batch Enrichment ───

export interface EnrichedSimilarQuestion {
  questionId: string;
  questionText: string;
  sectionId?: string;
  sectionTitle?: string;
  similarity: number;
  hasAnswer: boolean;
  answerPreview?: string;
  inSameCluster: boolean;
  clusterId?: string;
}

/**
 * Enrich similar matches with full question data and answer status.
 * Uses batch prefix queries instead of N+1 individual GetItem calls.
 */
export const enrichSimilarMatches = async (
  matches: SimilarMatch[],
  projectId: string,
  opportunityId: string,
  fileId: string,
  sourceClusterId?: string,
): Promise<EnrichedSimilarQuestion[]> => {
  if (matches.length === 0) return [];

  // Batch-fetch all questions and answers for the project+opportunity prefix
  const skPrefix = fileId
    ? `${projectId}#${opportunityId}#${fileId}#`
    : `${projectId}#${opportunityId}#`;

  const [allQuestions, allAnswers] = await Promise.all([
    queryBySkPrefix<QuestionDBItem>(QUESTION_PK, skPrefix),
    queryBySkPrefix<AnswerDBItem>(ANSWER_PK, skPrefix),
  ]);

  // Build lookup maps
  const questionMap = new Map<string, QuestionDBItem>();
  for (const q of allQuestions) {
    if (q.questionId) questionMap.set(q.questionId, q);
  }

  const answerMap = new Map<string, AnswerDBItem>();
  for (const a of allAnswers) {
    if (a.questionId) answerMap.set(a.questionId, a);
  }

  const enriched: EnrichedSimilarQuestion[] = [];

  for (const match of matches) {
    const fullQuestion = questionMap.get(match.questionId);
    if (!fullQuestion) continue; // stale Pinecone vector

    const answer = answerMap.get(match.questionId);
    const hasAnswerVal = !!(answer?.text);
    const answerPreview = hasAnswerVal
      ? answer!.text.substring(0, 150) + (answer!.text.length > 150 ? '...' : '')
      : undefined;

    enriched.push({
      questionId: match.questionId,
      questionText: fullQuestion.question || match.questionText || '',
      sectionId: fullQuestion.sectionId || match.sectionId,
      sectionTitle: fullQuestion.sectionTitle || match.sectionTitle,
      similarity: match.similarity,
      hasAnswer: hasAnswerVal,
      answerPreview,
      inSameCluster: !!(fullQuestion.clusterId && sourceClusterId && fullQuestion.clusterId === sourceClusterId),
      clusterId: fullQuestion.clusterId,
    });
  }

  return enriched.sort((a, b) => b.similarity - a.similarity);
};
