import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/question';
import { ANSWER_PK } from '../constants/answer';
import { PK as COLLAB_PK } from '../constants/collaboration';
import { requireEnv } from './env';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { deleteItem, docClient, getItem, putItem, queryBySkPrefix, type DBItem } from './db';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { CreateQuestions, QuestionItem } from '@auto-rfp/core';

export type QuestionItemDynamo = QuestionItem & DBItem;

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export async function getQuestionItemById(
  projectId: string,
  opportunityId: string,
  fileId: string,
  questionId: string,
): Promise<QuestionItemDynamo> {
  // When fileId is provided, do a direct GetItem for exact SK match
  if (fileId) {
    const sk = buildQuestionSK(projectId, opportunityId, fileId, questionId);
    const res = await docClient.send(
      new GetCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: QUESTION_PK,
          [SK_NAME]: sk,
        },
      }),
    );

    if (!res.Item) {
      throw new Error(`Question not found for PK=${QUESTION_PK}, SK=${sk}`);
    }

    const item = res.Item as QuestionItemDynamo;

    if (!item.question) {
      throw new Error(`Question item for SK=${sk} has no "question" field`);
    }

    return item;
  }

  // When fileId is missing, use a prefix query to find the question across any file.
  // SK pattern: {projectId}#{opportunityId}#{fileId}#{questionId}
  // We query with prefix {projectId}#{opportunityId}# and filter by questionId.
  const skPrefix = `${projectId}#${opportunityId}#`;
  const items = await queryBySkPrefix<QuestionItemDynamo & Record<string, unknown>>(QUESTION_PK, skPrefix);

  const match = items.find(
    (item) => item.questionId === questionId || item[SK_NAME]?.toString().endsWith(`#${questionId}`),
  );

  if (!match) {
    throw new Error(`Question not found for PK=${QUESTION_PK}, prefix=${skPrefix}, questionId=${questionId}`);
  }

  if (!match.question) {
    throw new Error(`Question item for questionId=${questionId} has no "question" field`);
  }

  return match;
}

export function normalizeQuestionText(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function isConditionalCheckFailed(err: unknown): boolean {
  const name = (err as { name?: string; code?: string })?.name ?? (err as { code?: string })?.code;
  return name === 'ConditionalCheckFailedException';
}

/**
 * Build the sort key for a question.
 * Pattern: {projectId}#{opportunityId}#{fileId}#{questionId}
 * questionId is the sha256 hash of the normalized question text.
 */
export const buildQuestionSK = (
  projectId: string,
  opportunityId: string,
  fileId: string,
  questionId: string,
): string => `${projectId}#${opportunityId}#${fileId}#${questionId}`;

export interface CreatedQuestion {
  questionId: string;
  question: string;
  sectionTitle: string;
}

/**
 * Persist manually-created questions for a project+opportunity.
 * Returns the list of created question summaries.
 */
export const createQuestions = async (dto: CreateQuestions): Promise<CreatedQuestion[]> => {
  const { projectId, opportunityId, questionFileId, sections } = dto;
  const fileId = questionFileId ?? 'manual';
  const createdQuestions: CreatedQuestion[] = [];

  for (const section of sections) {
    const sectionId = section.id ?? uuidv4();
    const sectionTitle = section.title ?? 'Untitled Section';

    for (const q of section.questions) {
      const trimmed = q.question.trim();
      if (!trimmed) continue;

      const questionId = uuidv4();
      const sk = buildQuestionSK(projectId, opportunityId, fileId, questionId);

      await putItem(QUESTION_PK, sk, {
        projectId,
        opportunityId,
        questionFileId: fileId,
        questionId,
        question: trimmed,
        sectionId,
        sectionTitle,
        sectionDescription: null,
      });

      createdQuestions.push({ questionId, question: trimmed, sectionTitle });
    }
  }

  return createdQuestions;
};

export interface DeleteQuestionResult {
  questionDeleted: boolean;
  answersDeleted: number;
  assignmentsDeleted: number;
  commentsDeleted: number;
}

/**
 * Delete a question and cascade-delete its answer, assignments, and comments.
 * Returns false (404) if the question does not exist.
 */
export const deleteQuestion = async (
  projectId: string,
  opportunityId: string,
  fileId: string,
  questionId: string,
  orgId?: string,
): Promise<DeleteQuestionResult | null> => {
  const sk = buildQuestionSK(projectId, opportunityId, fileId, questionId);

  const existing = await getItem(QUESTION_PK, sk);
  if (!existing) return null;

  await deleteItem(QUESTION_PK, sk);

  // Delete the associated answer (same SK pattern)
  let answersDeleted = 0;
  try {
    await deleteItem(ANSWER_PK, sk);
    answersDeleted = 1;
  } catch {
    // Answer may not exist — not an error
  }

  // Cascade delete assignments + comments scoped to this question
  let assignmentsDeleted = 0;
  let commentsDeleted = 0;

  if (orgId) {
    const assignmentItems = await queryBySkPrefix<{ partition_key: string; sort_key: string }>(
      COLLAB_PK.ASSIGNMENT,
      `${orgId}#${projectId}#${questionId}`,
    );
    for (const item of assignmentItems) {
      await deleteItem(COLLAB_PK.ASSIGNMENT, item.sort_key);
      assignmentsDeleted++;
    }

    const commentItems = await queryBySkPrefix<{ partition_key: string; sort_key: string }>(
      COLLAB_PK.COMMENT,
      `${orgId}#${projectId}#QUESTION#${questionId}#`,
    );
    for (const item of commentItems) {
      await deleteItem(COLLAB_PK.COMMENT, item.sort_key);
      commentsDeleted++;
    }
  }

  return { questionDeleted: true, answersDeleted, assignmentsDeleted, commentsDeleted };
};

/**
 * Build the SK prefix to query all questions for a project+opportunity+file.
 */
export const buildQuestionSKPrefix = (
  projectId: string,
  opportunityId: string,
  fileId?: string,
): string => fileId
  ? `${projectId}#${opportunityId}#${fileId}#`
  : `${projectId}#${opportunityId}#`;
