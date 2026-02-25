import { queryBySkPrefix } from '@/helpers/db';
import { updateRFPDocumentMetadata, uploadRFPDocumentHtml } from '@/helpers/rfp-document';
import { loadAllSolicitationTexts } from '@/helpers/executive-opportunity-brief';
import { getTemplate, listTemplatesByOrg, loadTemplateHtml } from '@/helpers/template';
import { MAX_SOLICITATION_CHARS } from '@/constants/document-generation';
import { QUESTION_PK } from '@/constants/question';
import type { RFPDocumentContent, TemplateSection } from '@auto-rfp/core';
import type { BedrockResponse, QaPair } from '@/types/document-generation';

export type { QaPair };

// ─── Template HTML builder ────────────────────────────────────────────────────

/**
 * Converts template sections to an HTML scaffold that the AI model fills in.
 * Each section becomes an <h2> with its description as a comment, and
 * placeholder content markers so the model knows what to replace.
 */
export const buildTemplateHtmlScaffold = (sections: TemplateSection[]): string => {
  if (!sections.length) return '';

  const parts: string[] = [
    `<!-- TEMPLATE SCAFFOLD: Fill in all [CONTENT] placeholders with real content -->`,
  ];

  for (const section of sections.sort((a, b) => a.order - b.order)) {
    parts.push(
      `<h2 style="font-size:1.4em;font-weight:700;margin:1.5em 0 0.5em;color:#1a1a2e;border-bottom:1px solid #e2e8f0;padding-bottom:0.2em">${section.title}</h2>`,
    );

    if (section.description) {
      parts.push(
        `<!-- Section guidance: ${section.description} -->`,
      );
    }

    // If the section has pre-authored content (e.g. boilerplate), include it
    if (section.content?.trim()) {
      parts.push(section.content.trim());
    } else {
      parts.push(
        `<p style="margin:0 0 1em;line-height:1.7;color:#374151">[CONTENT: Write 3-5 paragraphs for "${section.title}" based on the solicitation and Q&A context]</p>`,
      );
    }

    // Sections no longer have subsections — content is stored directly in section.content
  }

  return parts.join('\n');
};

// ─── Bedrock response parsing ───

export const extractBedrockText = (outer: BedrockResponse): string => {
  const text = outer.content?.[0]?.text?.trim();
  if (text) return text;
  if (outer.output_text?.trim()) return outer.output_text.trim();
  if (outer.completion?.trim()) return outer.completion.trim();
  return '';
};

// ─── Q&A pairs ───

export async function loadQaPairs(projectId: string): Promise<QaPair[]> {
  const items = await queryBySkPrefix<QaPair & { question?: string; answer?: string }>(
    QUESTION_PK,
    `${projectId}#`,
  );
  return items.map(({ question = '', answer = '' }) => ({ question, answer }));
}

// ─── Solicitation text ───

export async function loadSolicitation(projectId: string, opportunityId: string): Promise<string> {
  try {
    return await loadAllSolicitationTexts(projectId, opportunityId, MAX_SOLICITATION_CHARS);
  } catch (err) {
    console.warn('Failed to load solicitation texts:', (err as Error)?.message);
    return '';
  }
}

// ─── Template scaffold preprocessing ───

/**
 * Macro labels for display in the AI scaffold.
 * These replace {{MACRO}} placeholders so the AI understands what value to use.
 */
const MACRO_LABELS: Record<string, string> = {
  COMPANY_NAME:    '[Your Company Name]',
  PROJECT_TITLE:   '[Project Title]',
  CONTRACT_NUMBER: '[Contract/Solicitation Number]',
  SUBMISSION_DATE: '[Submission Deadline Date]',
  PAGE_LIMIT:      '[Page Limit]',
  OPPORTUNITY_ID:  '[Opportunity ID]',
  AGENCY_NAME:     '[Agency/Customer Name]',
  TODAY:           '[Current Date]',
  PROPOSAL_TITLE:  '[Proposal Title]',
  CONTENT:         '[CONTENT: Write detailed, substantive content here based on the solicitation requirements and provided context. Minimum 3-5 paragraphs.]',
};

/**
 * Prepare a template's HTML for use as an AI scaffold:
 * 1. Replace {{MACRO}} placeholders with descriptive labels the AI can understand
 * 2. Strip broken s3key: image src attributes (replace with placeholder)
 * 3. Add a scaffold header comment
 */
export const prepareTemplateScaffoldForAI = (html: string): string => {
  if (!html?.trim()) return '';

  let scaffold = html;

  // Replace {{MACRO}} placeholders with descriptive labels
  scaffold = scaffold.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    return MACRO_LABELS[key] ?? `[${key.replace(/_/g, ' ')}]`;
  });

  // Replace broken s3key: image src with a placeholder comment
  scaffold = scaffold.replace(
    /<img([^>]*?)src="s3key:[^"]*"([^>]*?)>/gi,
    '<!-- [IMAGE PLACEHOLDER: Insert relevant image or diagram here] -->',
  );

  // Also handle data-s3-key images that might have presigned URLs
  scaffold = scaffold.replace(
    /<img([^>]*?)data-s3-key="[^"]*"([^>]*?)>/gi,
    '<!-- [IMAGE PLACEHOLDER: Insert relevant image or diagram here] -->',
  );

  // Determine if the template has meaningful structure (headings) or is just a content placeholder
  const hasHeadings = /<h[1-6]/i.test(scaffold);

  if (hasHeadings) {
    // Structured template — AI must preserve all headings and fill in content
    return `<!-- TEMPLATE SCAFFOLD: You MUST follow this exact structure. Keep ALL <h1>, <h2>, <h3> headings exactly as written. Fill in all [CONTENT] and [placeholder] markers with real, detailed content. Do NOT add extra sections or headings not in this template. -->\n${scaffold}`;
  } else {
    // Simple content placeholder template — AI should generate full content and wrap it in the template structure
    return `<!-- TEMPLATE SCAFFOLD: This template defines the document wrapper/structure. Replace [CONTENT: ...] with a complete, well-structured HTML document body including appropriate headings and paragraphs. Keep all other text and elements (dates, company name placeholders, etc.) in their original positions. -->\n${scaffold}`;
  }
};

// ─── Template HTML resolution ───

/**
 * Resolve the HTML scaffold for a template.
 * Loads the template's HTML content from S3 via htmlContentKey.
 * Falls back to building a scaffold from sections for legacy templates.
 * Returns null if no template is found or has no content.
 */
export async function resolveTemplateHtml(
  orgId: string,
  documentType: string,
  templateId?: string,
): Promise<string | null> {
  let template = null;

  if (templateId) {
    template = await getTemplate(orgId, templateId);
  } else {
    try {
      // Load all non-archived templates for this category (up to 50)
      // and pick the most recently updated one, preferring PUBLISHED over DRAFT
      const { items: allItems } = await listTemplatesByOrg(orgId, {
        category: documentType,
        excludeArchived: true,
        limit: 50,
      });

      if (allItems.length === 0) {
        return null;
      }

      // Sort: PUBLISHED first, then by updatedAt descending (most recent first)
      const sorted = [...allItems].sort((a, b) => {
        // PUBLISHED templates take priority over DRAFT
        if (a.status === 'PUBLISHED' && b.status !== 'PUBLISHED') return -1;
        if (b.status === 'PUBLISHED' && a.status !== 'PUBLISHED') return 1;
        // Within same status, most recently updated first
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      template = sorted[0];
      console.log(`Auto-selected template for ${documentType}: "${template.name}" (${template.status}, updated: ${template.updatedAt})`);
    } catch {
      return null;
    }
  }

  if (!template) return null;

  // New pattern: HTML content stored in S3 via htmlContentKey
  if (template.htmlContentKey) {
    try {
      const html = await loadTemplateHtml(template.htmlContentKey);
      if (html?.trim()) {
        console.log(`Loaded template HTML from S3: ${template.htmlContentKey}`);
        // Preprocess the HTML for AI consumption: resolve macros, strip broken images
        return prepareTemplateScaffoldForAI(html);
      }
    } catch (err) {
      console.warn('Failed to load template HTML from S3, falling back to sections:', err);
    }
  }

  // Legacy fallback: build scaffold from sections
  if (template.sections?.length) {
    return buildTemplateHtmlScaffold(template.sections as TemplateSection[]);
  }

  return null;
}

/**
 * @deprecated Use resolveTemplateHtml instead.
 * Kept for backward compatibility — returns sections array.
 */
export async function resolveTemplateSections(
  orgId: string,
  documentType: string,
  templateId?: string,
): Promise<unknown[] | null> {
  if (templateId) {
    const t = await getTemplate(orgId, templateId);
    return t?.sections ?? null;
  }
  try {
    const { items } = await listTemplatesByOrg(orgId, {
      category: documentType,
      status: 'PUBLISHED',
      limit: 1,
    });
    return items?.[0]?.sections ?? null;
  } catch {
    return null;
  }
}

// ─── Document status update ───
// When status is COMPLETE and content is provided:
//   1. Upload the HTML body to S3 and store only the key in DynamoDB (htmlContentKey).
//   2. Store metadata (title, customerName, outlineSummary, opportunityId) in DynamoDB content field
//      WITHOUT the large `content` (html) string — that lives in S3.

export async function updateDocumentStatus(
  projectId: string,
  opportunityId: string,
  documentId: string,
  status: 'COMPLETE' | 'FAILED',
  content?: RFPDocumentContent,
  generationError?: string,
  orgId?: string,
): Promise<void> {
  let htmlContentKey: string | undefined;

  // Upload HTML to S3 when we have content and an orgId to build the key
  if (status === 'COMPLETE' && content?.content && orgId) {
    try {
      htmlContentKey = await uploadRFPDocumentHtml({
        orgId,
        projectId,
        opportunityId,
        documentId,
        html: content.content,
      });
      console.log(`HTML content uploaded to S3: ${htmlContentKey}`);
    } catch (err) {
      console.error('Failed to upload HTML to S3, falling back to DynamoDB storage:', err);
      // Fall back: keep content in DynamoDB if S3 upload fails
    }
  }

  // Build the content object stored in DynamoDB — metadata only, no HTML (HTML lives in S3)
  const dbContent = content
    ? {
        title: content.title,
        customerName: content.customerName,
        opportunityId: content.opportunityId,
        outlineSummary: content.outlineSummary,
      }
    : undefined;

  await updateRFPDocumentMetadata({
    projectId,
    opportunityId,
    documentId,
    updates: {
      status,
      ...(dbContent && {
        content: dbContent,
        title: content!.title || 'Generated Document',
        name: content!.title || 'Generated Document',
      }),
      ...(htmlContentKey && { htmlContentKey }),
      ...(generationError && { generationError }),
    },
    updatedBy: 'system',
  });
}
