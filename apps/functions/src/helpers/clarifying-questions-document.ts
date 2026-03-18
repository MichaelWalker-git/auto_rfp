/**
 * Helper for generating Clarifying Questions export documents.
 * No AI generation — formats existing clarifying questions data into semantic HTML
 * that works well in TipTap editor, DOCX export, and PDF export.
 */
import type {
  ClarifyingQuestionItem,
  ClarifyingQuestionStatus,
  ClarifyingQuestionsExportOptions,
} from '@auto-rfp/core';
import { listClarifyingQuestionsByOpportunity } from '@/helpers/clarifying-question';
import {
  updateDocumentStatus,
  buildMacroValues,
} from '@/helpers/document-generation';
import { getTemplate, findBestTemplate, loadTemplateHtml, replaceMacros } from '@/helpers/template';

// ─── Constants ───

const PRIORITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const CATEGORY_ORDER: Record<string, number> = {
  SCOPE: 0,
  TECHNICAL: 1,
  PRICING: 2,
  SCHEDULE: 3,
  COMPLIANCE: 4,
  EVALUATION: 5,
  OTHER: 6,
};

const CATEGORY_LABELS: Record<string, string> = {
  SCOPE: 'Scope',
  TECHNICAL: 'Technical',
  PRICING: 'Pricing',
  SCHEDULE: 'Schedule',
  COMPLIANCE: 'Compliance',
  EVALUATION: 'Evaluation',
  OTHER: 'Other',
};

// ─── Filter & Sort ───

export const filterQuestions = (
  questions: ClarifyingQuestionItem[],
  options: {
    excludeStatuses?: ClarifyingQuestionStatus[];
    includeStatuses?: ClarifyingQuestionStatus[];
  },
): ClarifyingQuestionItem[] => {
  if (options.includeStatuses?.length) {
    return questions.filter((q) => options.includeStatuses!.includes(q.status));
  }
  const excludeSet = new Set(options.excludeStatuses ?? ['DISMISSED']);
  return questions.filter((q) => !excludeSet.has(q.status));
};

export const sortQuestions = (
  questions: ClarifyingQuestionItem[],
  sortBy: string,
  sortOrder: string,
): ClarifyingQuestionItem[] => {
  const sorted = [...questions].sort((a, b) => {
    switch (sortBy) {
      case 'priority':
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      case 'category':
        return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
      case 'status':
        return a.status.localeCompare(b.status);
      case 'createdAt':
      default:
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
  });
  return sortOrder === 'desc' ? sorted.reverse() : sorted;
};

// ─── Semantic HTML Generation ───

const groupByCategory = (
  questions: ClarifyingQuestionItem[],
): Map<string, ClarifyingQuestionItem[]> => {
  const groups = new Map<string, ClarifyingQuestionItem[]>();
  // Initialize groups in display order
  for (const category of Object.keys(CATEGORY_ORDER)) {
    groups.set(category, []);
  }
  for (const q of questions) {
    const list = groups.get(q.category) ?? [];
    list.push(q);
    groups.set(q.category, list);
  }
  return groups;
};

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Build HTML for a single question using semantic elements.
 * Uses <p> for question text, <blockquote> for references.
 */
const buildQuestionHtml = (
  q: ClarifyingQuestionItem,
  index: number,
  options: { includeRationale: boolean; includeReferences: boolean },
): string => {
  let html = `<p><strong>${index}.</strong> ${escapeHtml(q.question)}</p>\n`;

  if (options.includeRationale && q.rationale) {
    html += `<p><em>Why ask:</em> ${escapeHtml(q.rationale)}</p>\n`;
  }

  if (options.includeReferences && q.ambiguitySource?.snippet) {
    html += `<blockquote><strong>RFP Reference:</strong> "${escapeHtml(q.ambiguitySource.snippet)}"`;
    if (q.ambiguitySource.sectionRef) {
      html += `<br/>Section: ${escapeHtml(q.ambiguitySource.sectionRef)}`;
    }
    html += '</blockquote>\n';
  }

  return html;
};

/**
 * Build semantic HTML for questions, optionally grouped by category.
 * Uses <h2> for category headings and <ol> for numbered questions.
 */
export const buildQuestionsHtml = (
  questions: ClarifyingQuestionItem[],
  options: {
    groupByCategory: boolean;
    includeRationale: boolean;
    includeReferences: boolean;
  },
): string => {
  if (options.groupByCategory) {
    const groups = groupByCategory(questions);
    const sections: string[] = [];
    let globalIndex = 1;

    for (const [category, categoryQuestions] of groups) {
      if (categoryQuestions.length === 0) continue;

      const categoryLabel = CATEGORY_LABELS[category] ?? category;
      let sectionHtml = `<h2>${categoryLabel} Questions</h2>\n`;
      
      for (const q of categoryQuestions) {
        sectionHtml += buildQuestionHtml(q, globalIndex++, options);
      }
      
      sections.push(sectionHtml);
    }
    return sections.join('\n');
  }

  // Ungrouped — simple numbered list
  return questions.map((q, i) => buildQuestionHtml(q, i + 1, options)).join('\n');
};

/**
 * Build the full document HTML using semantic elements.
 * Uses <h1> for title, <p> for metadata, <h2> for sections.
 */
export const buildDefaultDocumentHtml = (
  questions: ClarifyingQuestionItem[],
  options: Partial<ClarifyingQuestionsExportOptions>,
  macros: Record<string, string>,
): string => {
  const questionsHtml = buildQuestionsHtml(questions, {
    groupByCategory: options.groupByCategory ?? true,
    includeRationale: options.includeRationale ?? false,
    includeReferences: options.includeReferences ?? false,
  });

  return `<h1>Clarifying Questions</h1>
<p><strong>${macros['OPPORTUNITY_TITLE'] || macros['PROJECT_TITLE'] || 'Opportunity'}</strong><br/>
Solicitation: ${macros['SOLICITATION_NUMBER'] || 'N/A'}<br/>
Prepared: ${macros['TODAY']}</p>

<p>The following questions have been identified based on our review of the solicitation documents. We respectfully request clarification on these items to ensure our proposal accurately addresses the Government's requirements.</p>

<p><strong>Total Questions: ${questions.length}</strong></p>

${questionsHtml}

<p><em>Generated by ${macros['COMPANY_NAME'] || 'Organization'} on ${macros['TODAY']}</em></p>`;
};

// ─── Template Resolution (without AI preprocessing) ───

/**
 * Resolve template HTML directly without AI preprocessing.
 * Unlike the document-generation version, this does NOT replace {{CONTENT}} with placeholder text,
 * allowing us to inject the actual questions HTML.
 */
const resolveTemplateHtmlRaw = async (
  orgId: string,
  documentType: string,
  templateId?: string,
): Promise<string | null> => {
  const template = templateId
    ? await getTemplate(orgId, templateId)
    : await findBestTemplate(orgId, documentType);

  if (!template?.htmlContentKey) return null;

  try {
    const html = await loadTemplateHtml(template.htmlContentKey);
    if (html?.trim()) {
      console.log(`Loaded raw template HTML from S3: ${template.htmlContentKey} (${html.length} chars)`);
      return html;
    }
  } catch (err) {
    console.warn('Failed to load template HTML from S3:', err);
  }

  return null;
};

// ─── Main Generation Function ───

export interface GenerateClarifyingQuestionsDocumentParams {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  templateId?: string;
  options?: ClarifyingQuestionsExportOptions;
}

export const generateClarifyingQuestionsDocument = async (
  params: GenerateClarifyingQuestionsDocumentParams,
): Promise<void> => {
  const { orgId, projectId, opportunityId, documentId, templateId, options } = params;
  const effectiveOptions: Partial<ClarifyingQuestionsExportOptions> = options ?? {};

  console.log(`Processing clarifying questions document for documentId=${documentId}`);

  // 1. Load clarifying questions
  const { items: allQuestions } = await listClarifyingQuestionsByOpportunity({
    orgId,
    projectId,
    opportunityId,
    limit: 1000, // Get all questions
  });

  if (!allQuestions.length) {
    await updateDocumentStatus(
      projectId,
      opportunityId,
      documentId,
      'FAILED',
      undefined,
      'No clarifying questions found for this opportunity',
    );
    return;
  }

  // 2. Filter and sort questions
  const filtered = filterQuestions(allQuestions, effectiveOptions);

  if (!filtered.length) {
    await updateDocumentStatus(
      projectId,
      opportunityId,
      documentId,
      'FAILED',
      undefined,
      'No questions match the selected filter criteria',
    );
    return;
  }

  const sorted = sortQuestions(filtered, effectiveOptions.sortBy ?? 'priority', effectiveOptions.sortOrder ?? 'desc');

  console.log(`Filtered ${sorted.length} questions from ${allQuestions.length} total`);

  // 3. Build macro values and resolve template (raw HTML, not preprocessed for AI)
  const macroValues = await buildMacroValues({ orgId, projectId, opportunityId });
  const templateHtml = await resolveTemplateHtmlRaw(orgId, 'CLARIFYING_QUESTIONS', templateId);

  // 4. Generate document HTML
  let finalHtml: string;

  if (templateHtml) {
    // Template provides structure — inject questions HTML into {{CONTENT}} placeholder
    const questionsHtml = buildQuestionsHtml(sorted, {
      groupByCategory: effectiveOptions.groupByCategory ?? true,
      includeRationale: effectiveOptions.includeRationale ?? false,
      includeReferences: effectiveOptions.includeReferences ?? false,
    });
    finalHtml = replaceMacros(templateHtml, { ...macroValues, CONTENT: questionsHtml });
  } else {
    // No template — use default semantic HTML formatting
    finalHtml = buildDefaultDocumentHtml(sorted, effectiveOptions, macroValues);
  }

  // 5. Save the document
  await updateDocumentStatus(
    projectId,
    opportunityId,
    documentId,
    'COMPLETE',
    { title: 'Clarifying Questions', content: finalHtml },
    undefined,
    orgId,
  );

  console.log(`Clarifying questions document complete for documentId=${documentId}: ${sorted.length} questions`);
};
