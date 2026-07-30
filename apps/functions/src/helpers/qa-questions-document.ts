/**
 * Q&A Questions Document Generator
 *
 * Generates an RFP document from extracted questions and their AI-generated answers.
 * Follows the same pattern as clarifying-questions-document.ts:
 * no AI generation — formats existing Q&A data into styled HTML.
 */

import { updateDocumentStatus } from './document-generation';
import { getOpportunity } from './opportunity';
import {
  loadQuestions,
  loadAnswers,
  groupQuestions,
  buildSectionsHtml,
  escapeHtml,
} from './qa-shared';
import type { AnswerItem } from '@auto-rfp/core';

// ─── Main Generator ───────────────────────────────────────────────────────────
// All shared functions (loadQuestions, loadAnswers, groupQuestions, buildSectionsHtml, escapeHtml)
// are now imported from qa-shared.ts to avoid duplication.

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
    'READY',
    { title: 'Questions & Answers', content: finalHtml },
    undefined,
    orgId,
  );

  console.log(`Q&A document complete for documentId=${documentId}: ${totalCount} questions`);
};
