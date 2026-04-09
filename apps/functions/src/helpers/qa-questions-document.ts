/**
 * Q&A Questions Document Generator
 *
 * Generates an RFP document from extracted questions and their AI-generated answers.
 * Follows the same pattern as clarifying-questions-document.ts:
 * no AI generation — formats existing Q&A data into styled HTML.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { requireEnv } from './env';
import { updateDocumentStatus } from './document-generation';
import { replaceMacros } from './template';
import { getOpportunity } from './opportunity';
import type { QuestionItem, AnswerItem, GroupedSection } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Data Loading ─────────────────────────────────────────────────────────────

const loadQuestions = async (projectId: string, opportunityId: string): Promise<QuestionItem[]> => {
  const items: QuestionItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        FilterExpression: '#oppId = :oppId',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
          '#oppId': 'opportunityId',
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_PK,
          ':prefix': `${projectId}#`,
          ':oppId': opportunityId,
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    if (res.Items) items.push(...(res.Items as QuestionItem[]));
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
};

const loadAnswers = async (projectId: string): Promise<Record<string, AnswerItem>> => {
  const grouped: Record<string, AnswerItem> = {};
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pk': ANSWER_PK, ':prefix': `${projectId}#` },
        ExclusiveStartKey: lastKey,
      }),
    );

    if (res.Items) {
      for (const item of res.Items as AnswerItem[]) {
        const qId = item.questionId;
        if (!qId) continue;
        const current = grouped[qId];
        if (!current || new Date(item.updatedAt || item.createdAt || '0').getTime() >
            new Date(current.updatedAt || current.createdAt || '0').getTime()) {
          grouped[qId] = item;
        }
      }
    }

    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return grouped;
};

// ─── HTML Builder ─────────────────────────────────────────────────────────────

const escapeHtml = (str: string): string =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const extractAnswerText = (answer: AnswerItem): string => {
  const raw = answer.text ?? '';
  // Handle JSON-formatted answers (some answers store { answer: "..." })
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.answer === 'string') return parsed.answer;
    } catch { /* not JSON */ }
  }
  return raw;
};

const buildSectionsHtml = (sections: GroupedSection[]): string => {
  const parts: string[] = [];

  for (const section of sections) {
    parts.push(`<h2 style="color:#1e3a5f; border-bottom:2px solid #e5e7eb; padding-bottom:8px; margin-top:24px;">${escapeHtml(section.title || 'Untitled Section')}</h2>`);

    if (section.description) {
      parts.push(`<p style="color:#6b7280; font-style:italic; margin-bottom:12px;">${escapeHtml(section.description)}</p>`);
    }

    for (let i = 0; i < section.questions.length; i++) {
      const q = section.questions[i];
      const answerText = q.answer || '';

      parts.push(`<div style="margin-bottom:16px; padding:12px; border:1px solid #e5e7eb; border-radius:8px; background:#fafafa;">`);
      parts.push(`<p style="font-weight:600; color:#111827; margin-bottom:6px;">Q${i + 1}: ${escapeHtml(q.question)}</p>`);

      if (answerText) {
        // If the answer contains HTML tags, use it as-is; otherwise wrap in <p>
        const isHtml = /<[a-z][\s\S]*>/i.test(answerText);
        if (isHtml) {
          parts.push(`<div style="color:#374151; padding-left:12px; border-left:3px solid #6366f1;">${answerText}</div>`);
        } else {
          parts.push(`<p style="color:#374151; padding-left:12px; border-left:3px solid #6366f1;">${escapeHtml(answerText)}</p>`);
        }
      } else {
        parts.push(`<p style="color:#9ca3af; font-style:italic; padding-left:12px;">(No answer)</p>`);
      }

      parts.push(`</div>`);
    }
  }

  return parts.join('\n');
};

const groupQuestions = (
  questions: QuestionItem[],
  answersMap: Record<string, AnswerItem>,
): GroupedSection[] => {
  const sectionsMap = new Map<string, GroupedSection>();

  for (const item of questions) {
    const secId = item.sectionId;
    if (!sectionsMap.has(secId)) {
      sectionsMap.set(secId, {
        id: secId,
        title: item.sectionTitle ?? '',
        description: item.sectionDescription ?? null,
        questions: [],
      });
    }

    const answer = answersMap[item.questionId];
    sectionsMap.get(secId)!.questions.push({
      id: item.questionId,
      question: item.question ?? '',
      answer: answer ? extractAnswerText(answer) : null,
    });
  }

  return Array.from(sectionsMap.values());
};

// ─── Main Generator ───────────────────────────────────────────────────────────

export interface GenerateQaDocumentParams {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  templateId?: string;
}

export const generateQaDocument = async (params: GenerateQaDocumentParams): Promise<void> => {
  const { orgId, projectId, opportunityId, documentId } = params;

  console.log(`Processing Q&A document for documentId=${documentId}`);

  // 1. Load questions and answers in parallel
  const [questions, answersMap] = await Promise.all([
    loadQuestions(projectId, opportunityId),
    loadAnswers(projectId),
  ]);

  if (!questions.length) {
    await updateDocumentStatus(projectId, opportunityId, documentId, 'FAILED', undefined, 'No questions found for this opportunity');
    return;
  }

  // Filter answers to only those for our questions
  const questionIds = new Set(questions.map((q) => q.questionId));
  const filteredAnswers: Record<string, AnswerItem> = {};
  for (const [qId, answer] of Object.entries(answersMap)) {
    if (questionIds.has(qId)) filteredAnswers[qId] = answer;
  }

  // 2. Group and build HTML
  const sections = groupQuestions(questions, filteredAnswers);
  const answeredCount = sections.reduce((sum, s) => sum + s.questions.filter((q) => q.answer).length, 0);
  const totalCount = sections.reduce((sum, s) => sum + s.questions.length, 0);

  console.log(`Found ${totalCount} questions (${answeredCount} answered) in ${sections.length} sections`);

  // Get opportunity title for the document header
  let opportunityTitle = 'Questions & Answers';
  try {
    const opp = await getOpportunity({ orgId, projectId, oppId: opportunityId });
    if (opp?.item?.title) opportunityTitle = `${opp.item.title} — Questions & Answers`;
  } catch { /* use default */ }

  const contentHtml = buildSectionsHtml(sections);

  const finalHtml = `
    <h1 style="color:#1e3a5f; margin-bottom:4px;">${escapeHtml(opportunityTitle)}</h1>
    <p style="color:#6b7280; margin-bottom:24px;">${totalCount} questions · ${answeredCount} answered · ${sections.length} sections</p>
    ${contentHtml}
  `.trim();

  // 3. Save the document
  await updateDocumentStatus(
    projectId,
    opportunityId,
    documentId,
    'COMPLETE',
    { title: 'Questions & Answers', content: finalHtml },
    undefined,
    orgId,
  );

  console.log(`Q&A document complete for documentId=${documentId}: ${totalCount} questions`);
};
