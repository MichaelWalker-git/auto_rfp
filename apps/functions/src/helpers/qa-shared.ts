/**
 * Shared Q&A Utilities
 *
 * Functions shared between qa-questions-document.ts and html-questionnaire-document.ts.
 * This file has NO dependencies on document-generation or bedrock to avoid pulling in
 * unnecessary env vars (like BEDROCK_MODEL_ID) in handlers that don't need AI.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { requireEnv } from './env';
import { isExtractedQuestionFile, listQuestionFilesByOpportunity } from './questionFile';
import type { QuestionItem, AnswerItem, GroupedSection } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Data Loading ─────────────────────────────────────────────────────────────

export const loadQuestions = async (projectId: string, opportunityId: string): Promise<QuestionItem[]> => {
  const items: QuestionItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: `#pk = :pk AND begins_with(#sk, :skPrefix)`,
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_PK,
          ':skPrefix': `${projectId}#${opportunityId}#`,
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    if (res.Items) items.push(...(res.Items as QuestionItem[]));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  // Filter out questions from non-extracted files (orphans from cancelled/failed pipelines)
  // See get-questions.ts handler for the original implementation
  const { items: questionFiles } = await listQuestionFilesByOpportunity({ projectId, oppId: opportunityId });
  const extractedFileIds = new Set(
    (questionFiles as Array<{ questionFileId: string; status: string }>)
      .filter((qf) => isExtractedQuestionFile(qf.status))
      .map((qf) => qf.questionFileId),
  );

  return items.filter((q) => q.questionFileId && extractedFileIds.has(q.questionFileId));
};

export const loadAnswers = async (projectId: string): Promise<Record<string, AnswerItem>> => {
  const grouped: Record<string, AnswerItem> = {};
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: `#pk = :pk AND begins_with(#sk, :skPrefix)`,
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': ANSWER_PK,
          ':skPrefix': `${projectId}#`,
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    if (res.Items) {
      for (const item of res.Items as AnswerItem[]) {
        if (!item.questionId) continue;

        // Keep the latest answer by timestamp (if multiple versions exist)
        const current = grouped[item.questionId];
        if (!current) {
          grouped[item.questionId] = item;
        } else {
          const currentTime = new Date(current.updatedAt || current.createdAt || '0').getTime();
          const itemTime = new Date(item.updatedAt || item.createdAt || '0').getTime();
          if (itemTime > currentTime) {
            grouped[item.questionId] = item;
          }
        }
      }
    }

    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return grouped;
};

// ─── HTML Builder ─────────────────────────────────────────────────────────────

export const escapeHtml = (str: string): string =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const extractAnswerText = (answer: AnswerItem): string => {
  const raw = answer.text ?? '';
  // Handle JSON-formatted answers (some answers store { answer: "..." })
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.answer && typeof parsed.answer === 'string') return parsed.answer;
    } catch { /* fall through */ }
  }
  return raw;
};

export const buildSectionsHtml = (sections: GroupedSection[]): string => {
  const parts: string[] = [];

  for (const section of sections) {
    // Section header
    if (section.title && section.title !== 'General') {
      parts.push(`<h2 style="color:#1e3a5f; margin-top:32px; margin-bottom:8px;">${escapeHtml(section.title)}</h2>`);
      if (section.description) {
        parts.push(`<p style="color:#6b7280; margin-bottom:16px;">${escapeHtml(section.description)}</p>`);
      }
    }

    // Questions
    for (const q of section.questions) {
      // Question
      parts.push(`<div style="margin-bottom:24px;">`);
      parts.push(`<p style="color:#374151; font-weight:600; margin-bottom:8px;">${escapeHtml(q.question)}</p>`);

      // Answer (or unanswered message)
      if (q.answer) {
        // Detect if answer contains HTML tags - if so, preserve it; otherwise escape
        const isHtml = /<[a-z][\s\S]*>/i.test(q.answer);
        parts.push(`<div style="color:#1f2937; line-height:1.6; padding-left:16px; border-left:3px solid #e5e7eb;">`);
        if (isHtml) {
          parts.push(q.answer); // Preserve HTML formatting
        } else {
          parts.push(escapeHtml(q.answer)); // Escape plain text
        }
        parts.push(`</div>`);
      } else {
        parts.push(`<p style="color:#9ca3af; font-style:italic;">Not yet answered</p>`);
      }

      parts.push(`</div>`);
    }
  }

  return parts.join('\n');
};

export const groupQuestions = (
  questions: QuestionItem[],
  answersMap: Record<string, AnswerItem>,
): GroupedSection[] => {
  const sectionsMap = new Map<string, GroupedSection>();

  for (const q of questions) {
    const sectionId = q.sectionId ?? 'general';
    const sectionTitle = q.sectionTitle ?? 'General';

    if (!sectionsMap.has(sectionId)) {
      sectionsMap.set(sectionId, {
        id: sectionId,
        title: sectionTitle,
        description: q.sectionDescription ?? null,
        questions: [],
      });
    }

    const answer = q.questionId ? answersMap[q.questionId] : undefined;
    const answerText = answer ? extractAnswerText(answer) : '';

    sectionsMap.get(sectionId)!.questions.push({
      id: q.questionId ?? '',
      question: q.question ?? '',
      answer: answerText || null,
    });
  }

  return Array.from(sectionsMap.values());
};
