/**
 * HTML Questionnaire Document Generator
 *
 * Generates HTML Q&A documents for non-XLSX questionnaires (DOCX, PDF, etc.).
 * One document per questionnaire file (Approach A).
 *
 * Reuses functions from qa-questions-document.ts to avoid duplication:
 * - loadQuestions, loadAnswers: Query DynamoDB
 * - groupQuestions, buildSectionsHtml: Build HTML structure
 * - escapeHtml, extractAnswerText: Formatting utilities
 */

import { v4 as uuidv4 } from 'uuid';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { nowIso } from '@/helpers/date';
import { buildRFPDocumentSK, putRFPDocument, uploadRFPDocumentHtml } from '@/helpers/rfp-document';
import { getTemplate, findBestTemplate, loadTemplateHtml, replaceMacros, buildMacroValues } from '@/helpers/template';
import {
  loadQuestions,
  loadAnswers,
  groupQuestions,
  buildSectionsHtml,
  escapeHtml,
} from '@/helpers/qa-shared';
import type { AnswerItem } from '@auto-rfp/core';

export interface GenerateHtmlQuestionnaireParams {
  orgId: string;
  projectId: string;
  opportunityId: string;
  questionFileId: string;       // Filter questions by this specific file
  originalFileName?: string;    // Used for output naming
  templateId?: string;          // Optional custom template
}

/**
 * Generate an HTML Q&A document for a specific questionnaire file.
 *
 * Unlike qa-questions-document.ts (which loads ALL questions for the opportunity),
 * this function filters questions by questionFileId to generate one document per file.
 */
export const generateHtmlQuestionnaireDocument = async (
  params: GenerateHtmlQuestionnaireParams
): Promise<void> => {
  const { orgId, projectId, opportunityId, questionFileId, originalFileName, templateId } = params;

  console.log(`Generating HTML questionnaire for file=${questionFileId} (${originalFileName || 'unnamed'})`);

  // 1. Load all questions and filter by questionFileId
  const allQuestions = await loadQuestions(projectId, opportunityId);
  const fileQuestions = allQuestions.filter(q => q.questionFileId === questionFileId);

  if (fileQuestions.length === 0) {
    console.log(`No questions found for questionnaire file ${questionFileId}, skipping`);
    return;
  }

  // 2. Load all answers and filter to match our questions
  const allAnswers = await loadAnswers(projectId);
  const questionIds = new Set(fileQuestions.map(q => q.questionId));
  const fileAnswers: Record<string, AnswerItem> = {};

  for (const [qId, answer] of Object.entries(allAnswers)) {
    if (questionIds.has(qId)) {
      fileAnswers[qId] = answer;
    }
  }

  if (Object.keys(fileAnswers).length === 0) {
    console.log(`No answers found for questionnaire ${questionFileId}, skipping`);
    return;
  }

  // 3. Group questions by section and build HTML (reuses qa-questions-document logic)
  const sections = groupQuestions(fileQuestions, fileAnswers);
  const answeredCount = sections.reduce((sum, s) => sum + s.questions.filter(q => q.answer).length, 0);
  const totalCount = sections.reduce((sum, s) => sum + s.questions.length, 0);

  console.log(`Questionnaire ${questionFileId}: ${totalCount} questions (${answeredCount} answered) in ${sections.length} sections`);

  // 4. Generate document name from original filename
  const outputName = originalFileName
    ? originalFileName.replace(/\.(docx?|pdf)$/i, '-responses')
    : 'Questionnaire Responses';

  // 5. Build Q&A content HTML
  const contentHtml = buildSectionsHtml(sections);

  // 6. Apply template if available
  let finalHtml: string;

  try {
    // Try to load template
    const template = templateId
      ? await getTemplate(orgId, templateId)
      : await findBestTemplate(orgId, 'QUESTIONNAIRE');

    if (template?.htmlContentKey) {
      console.log(`Using template: ${template.name || template.id}`);

      // Load template HTML
      const templateHtml = await loadTemplateHtml(template.htmlContentKey);

      if (templateHtml?.trim()) {
        // Build macro values using shared helper (supports 30+ macros)
        const macroValues = await buildMacroValues({
          orgId,
          projectId,
          opportunityId,
        });

        // Override CONTENT macro with Q&A-specific content
        macroValues.CONTENT = `
          <h1 style="color:#1e3a5f; margin-bottom:4px;">${escapeHtml(outputName)}</h1>
          <p style="color:#6b7280; margin-bottom:24px;">${totalCount} questions · ${answeredCount} answered · ${sections.length} sections</p>
          ${contentHtml}
        `.trim();

        // Apply macros to template
        finalHtml = replaceMacros(templateHtml, macroValues, { removeUnresolved: false });

        // Replace remaining unresolved macros with readable labels
        finalHtml = finalHtml.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_: string, key: string) =>
          `[${key.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}]`
        );
      } else {
        throw new Error('Template HTML is empty');
      }
    } else {
      throw new Error('No template HTML content key');
    }
  } catch (err) {
    // Fall back to default formatting if template fails
    console.log(`Template not available, using default formatting: ${(err as Error).message}`);
    finalHtml = `
      <h1 style="color:#1e3a5f; margin-bottom:4px;">${escapeHtml(outputName)}</h1>
      <p style="color:#6b7280; margin-bottom:24px;">${totalCount} questions · ${answeredCount} answered · ${sections.length} sections</p>
      ${contentHtml}
    `.trim();
  }

  // 7. Upload HTML to S3 and create RFP document
  // (avoid importing document-generation which pulls in Bedrock dependencies)
  const documentId = uuidv4();
  const now = nowIso();

  // Upload HTML to S3 (same pattern as other documents)
  console.log(`[html-questionnaire] Uploading HTML to S3: ${finalHtml.length} chars`);
  const htmlContentKey = await uploadRFPDocumentHtml({
    orgId,
    projectId,
    opportunityId,
    documentId,
    html: finalHtml,
  });

  await putRFPDocument({
    [PK_NAME]: RFP_DOCUMENT_PK,
    [SK_NAME]: buildRFPDocumentSK(projectId, opportunityId, documentId),
    documentId,
    projectId,
    opportunityId,
    orgId,
    name: outputName,
    description: `Auto-generated Q&A document from ${originalFileName || 'questionnaire'}`,
    documentType: 'QUESTIONNAIRE',
    htmlContentKey, // S3 reference, not inline content
    version: 1,
    status: 'READY',
    signatureStatus: 'NOT_REQUIRED',
    linearSyncStatus: 'NOT_SYNCED',
    createdBy: 'system',
    updatedBy: 'system',
    createdByName: 'AutoRFP Pipeline',
    updatedByName: 'AutoRFP Pipeline',
    createdAt: now,
    updatedAt: now,
  });

  console.log(`Generated HTML questionnaire document ${documentId} for file ${questionFileId}: ${answeredCount} answers`);
};
