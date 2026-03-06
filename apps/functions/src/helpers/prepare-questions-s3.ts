/**
 * S3 output helpers for the prepare-questions pipeline.
 */

import { requireEnv } from '@/helpers/env';
import { uploadToS3 } from '@/helpers/s3';
import type { QuestionForAnswerGeneration, QuestionReference } from '@/handlers/answer-pipeline/types';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

/**
 * Serialize questions as JSONL (one JSON object per line) and upload to S3.
 * Returns the S3 key used.
 */
export const writeQuestionsToS3 = async (
  projectId: string,
  questions: QuestionForAnswerGeneration[],
): Promise<string> => {
  const s3Key = `answer-pipeline/${projectId}/${Date.now()}-questions.jsonl`;

  const questionReferences: QuestionReference[] = questions.map((q) => ({
    questionId: q.questionId,
    projectId: q.projectId,
    orgId: q.orgId,
    opportunityId: q.opportunityId ?? null,
    questionFileId: q.questionFileId ?? null,
    isClusterMaster: q.isClusterMaster ?? null,
    masterQuestionId: q.masterQuestionId ?? null,
  }));

  const jsonlContent = questionReferences.map((q) => JSON.stringify(q)).join('\n');
  await uploadToS3(DOCUMENTS_BUCKET, s3Key, jsonlContent, 'application/x-ndjson');

  console.log(`Wrote ${questions.length} questions to s3://${DOCUMENTS_BUCKET}/${s3Key}`);
  return s3Key;
};

/** The S3 bucket name used for pipeline output. */
export const getDocumentsBucket = (): string => DOCUMENTS_BUCKET;
