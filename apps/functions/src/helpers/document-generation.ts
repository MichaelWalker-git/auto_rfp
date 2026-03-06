import { v4 as uuidv4 } from 'uuid';
import { queryBySkPrefix } from '@/helpers/db';
import { updateRFPDocumentMetadata, uploadRFPDocumentHtml, getRFPDocument } from '@/helpers/rfp-document';
import { loadAllSolicitationTexts } from '@/helpers/executive-opportunity-brief';
import { getTemplate, listTemplatesByOrg, loadTemplateHtml, replaceMacros } from '@/helpers/template';
import { MAX_SOLICITATION_CHARS } from '@/constants/document-generation';
import { QUESTION_PK } from '@/constants/question';
import {
  createVersion,
  getLatestVersionNumber,
  saveVersionHtml,
} from '@/helpers/rfp-document-version';
import type { RFPDocumentContent, TemplateSection } from '@auto-rfp/core';
import type { BedrockResponse, QaPair } from '@/types/document-generation';
import { getProjectById } from '@/helpers/project';
import { getOrganizationById } from '@/handlers/organization/get-organization-by-id';
import { getOpportunity } from '@/helpers/opportunity';

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
      `<h2 style="font-size:1.4em;font-weight:700;margin:1.5em 0 0.5em;color:#1a1a2e">${section.title}</h2>`,
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
  // New SK: {projectId}#{opportunityId}#{questionId} — query by projectId prefix to get all
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
 * Macro labels for display in the AI scaffold (DEPRECATED - only used as fallback).
 * These replace {{MACRO}} placeholders so the AI understands what value to use.
 * @deprecated Use buildMacroValues to get real data instead of placeholder labels.
 */
const MACRO_LABELS: Record<string, string> = {
  // Organization variables
  COMPANY_NAME:              '[Your Company Name]',
  ORGANIZATION_DESCRIPTION:  '[Organization Description]',

  // Project variables
  PROJECT_TITLE:             '[Project Title]',
  PROJECT_DESCRIPTION:       '[Project Description]',
  PROPOSAL_TITLE:            '[Proposal Title]',

  // Opportunity variables
  OPPORTUNITY_ID:            '[Opportunity ID]',
  OPPORTUNITY_TITLE:         '[Opportunity Title]',
  SOLICITATION_NUMBER:       '[Solicitation Number]',
  NOTICE_ID:                 '[Notice ID]',

  // Agency/Customer information
  AGENCY_NAME:               '[Agency/Customer Name]',
  ISSUING_OFFICE:            '[Issuing Office]',

  // Dates
  TODAY:                     '[Current Date]',
  CURRENT_YEAR:              '[Current Year]',
  CURRENT_MONTH:             '[Current Month]',
  CURRENT_DAY:               '[Current Day]',
  POSTED_DATE:               '[Posted Date]',
  RESPONSE_DEADLINE:         '[Response Deadline]',
  SUBMISSION_DATE:           '[Submission Date]',

  // Compliance & Classification
  NAICS_CODE:                '[NAICS Code]',
  PSC_CODE:                  '[PSC Code]',
  SET_ASIDE:                 '[Set-Aside Type]',
  OPPORTUNITY_TYPE:          '[Opportunity Type]',

  // Financial
  ESTIMATED_VALUE:           '[Estimated Contract Value]',
  BASE_AND_OPTIONS_VALUE:    '[Base and All Options Value]',

  // Content placeholder
  CONTENT:                   '[CONTENT: Write detailed, substantive content here based on the solicitation requirements and provided context. Minimum 3-5 paragraphs.]',
};

/**
 * Build macro values from real project, organization, and opportunity data.
 * Returns a Record<string, string> that can be passed to replaceMacros().
 */
export const buildMacroValues = async (params: {
  orgId: string;
  projectId: string;
  opportunityId?: string;
}): Promise<Record<string, string>> => {
  const { orgId, projectId, opportunityId } = params;

  // Load data in parallel
  const [project, org, opportunity] = await Promise.all([
    getProjectById(projectId),
    getOrganizationById(orgId),
    opportunityId ? getOpportunity({ orgId, projectId, oppId: opportunityId }).then(result => result?.item) : Promise.resolve(undefined),
  ]);

  // Build macro values from loaded data
  const today = new Date();
  const macroValues: Record<string, string> = {
    // Date macros
    TODAY: today.toISOString().split('T')[0], // YYYY-MM-DD format
    CURRENT_YEAR: String(today.getFullYear()),
    CURRENT_MONTH: today.toLocaleDateString('en-US', { month: 'long' }),
    CURRENT_DAY: String(today.getDate()),
    // CONTENT macro: replaced with a visible placeholder so the AI knows where to insert generated content.
    // An empty string would make the placeholder invisible and the AI would ignore the template structure.
    CONTENT: '[CONTENT: Write the complete document content here based on the solicitation requirements and provided context. Preserve all surrounding template elements (images, dates, company name, etc.) exactly as they appear.]',
  };

  // Organization macros
  if (org) {
    macroValues.COMPANY_NAME = org.name || '';
    macroValues.ORGANIZATION_DESCRIPTION = org.description || '';
  }

  // Project macros
  if (project) {
    macroValues.PROJECT_TITLE = project.name || '';
    macroValues.PROPOSAL_TITLE = project.name || '';
    macroValues.PROJECT_DESCRIPTION = project.description || '';
  }

  // Opportunity macros
  if (opportunity) {
    // IDs and Numbers
    macroValues.OPPORTUNITY_ID = opportunity.id || '';
    macroValues.NOTICE_ID = opportunity.noticeId || '';
    macroValues.SOLICITATION_NUMBER = opportunity.solicitationNumber || '';
    macroValues.OPPORTUNITY_TITLE = opportunity.title || '';

    // Agency information
    macroValues.AGENCY_NAME = opportunity.organizationName || '';
    macroValues.ISSUING_OFFICE = opportunity.organizationName || '';

    // Dates - format ISO dates to readable format
    if (opportunity.postedDateIso) {
      try {
        const postedDate = new Date(opportunity.postedDateIso);
        macroValues.POSTED_DATE = postedDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      } catch {
        macroValues.POSTED_DATE = opportunity.postedDateIso;
      }
    }

    if (opportunity.responseDeadlineIso) {
      try {
        const deadlineDate = new Date(opportunity.responseDeadlineIso);
        macroValues.RESPONSE_DEADLINE = deadlineDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        macroValues.SUBMISSION_DATE = macroValues.RESPONSE_DEADLINE; // Alias for backward compatibility
      } catch {
        macroValues.RESPONSE_DEADLINE = opportunity.responseDeadlineIso;
        macroValues.SUBMISSION_DATE = opportunity.responseDeadlineIso;
      }
    }

    // Classification codes
    macroValues.NAICS_CODE = opportunity.naicsCode || '';
    macroValues.PSC_CODE = opportunity.pscCode || '';

    // Compliance information
    macroValues.SET_ASIDE = opportunity.setAside || '';
    macroValues.OPPORTUNITY_TYPE = opportunity.type || '';

    // Financial information
    if (opportunity.baseAndAllOptionsValue) {
      const value = opportunity.baseAndAllOptionsValue;
      // Format as currency if it's a number
      if (typeof value === 'number' && value > 0) {
        macroValues.ESTIMATED_VALUE = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(value);
        macroValues.BASE_AND_OPTIONS_VALUE = macroValues.ESTIMATED_VALUE;
      } else {
        macroValues.ESTIMATED_VALUE = String(value);
        macroValues.BASE_AND_OPTIONS_VALUE = String(value);
      }
    }
  }

  return macroValues;
};

/**
 * Prepare a template's HTML for use as an AI scaffold:
 * 1. Replace {{MACRO}} placeholders with real values from macroValues (or descriptive labels as fallback)
 * 2. Strip broken s3key: image src attributes (replace with placeholder)
 * 3. Add a scaffold header comment
 *
 * @param html - The raw template HTML with {{MACRO}} placeholders
 * @param macroValues - Real values to replace macros with (e.g., {COMPANY_NAME: "Acme Corp"})
 */
export const prepareTemplateScaffoldForAI = (
  html: string,
  macroValues?: Record<string, string>,
): string => {
  if (!html?.trim()) return '';

  let scaffold = html;

  // Replace {{MACRO}} placeholders with real values if provided, otherwise use descriptive labels
  if (macroValues && Object.keys(macroValues).length > 0) {
    // Use replaceMacros from template.ts to replace with real values
    scaffold = replaceMacros(scaffold, macroValues, { removeUnresolved: false });

    // For any remaining unresolved macros (not in macroValues), replace with descriptive labels
    scaffold = scaffold.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => {
      return MACRO_LABELS[key] ?? `[${key.replace(/_/g, ' ')}]`;
    });
  } else {
    // Fallback to placeholder labels (old behavior)
    scaffold = scaffold.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => {
      return MACRO_LABELS[key] ?? `[${key.replace(/_/g, ' ')}]`;
    });
  }

  // Preserve image tags — do NOT strip them.
  // Images use s3key: protocol or data-s3-key attributes that are resolved
  // to presigned URLs at display time by the frontend.
  // Add a marker comment so the AI knows to keep them untouched.
  scaffold = scaffold.replace(
    /(<img[^>]*?(?:src="s3key:[^"]*"|data-s3-key="[^"]*")[^>]*?>)/gi,
    '<!-- PRESERVE THIS IMAGE TAG EXACTLY AS-IS -->$1',
  );

  // Determine if the template has meaningful structure (headings) or is just a content placeholder
  const hasHeadings = /<h[1-6]/i.test(scaffold);

  if (hasHeadings) {
    // Structured template — AI must preserve all headings and fill in content
    return `<!-- TEMPLATE SCAFFOLD: You MUST follow this exact structure. Keep ALL <h1>, <h2>, <h3> headings exactly as written. Fill in all [CONTENT] and [placeholder] markers with real, detailed content. Do NOT add extra sections or headings not in this template. -->\n${scaffold}`;
  } else {
    // Simple content placeholder template — AI should generate full content and wrap it in the template structure
    return `<!-- TEMPLATE SCAFFOLD: This template defines the document wrapper/structure. Replace [CONTENT: ...] with a complete, well-structured HTML document body including appropriate headings and paragraphs. Keep all other text and elements (dates, company name, etc.) in their original positions. -->\n${scaffold}`;
  }
};

// ─── Template HTML resolution ───

/**
 * Resolve the HTML scaffold for a template with real macro values.
 * Loads the template's HTML content from S3 via htmlContentKey.
 * Falls back to building a scaffold from sections for legacy templates.
 * Returns null if no template is found or has no content.
 *
 * @param orgId - Organization ID
 * @param documentType - Document type (e.g., 'COVER_LETTER', 'EXECUTIVE_SUMMARY')
 * @param templateId - Optional template ID. If not provided, auto-selects the best template.
 * @param macroValues - Optional macro values to replace {{MACRO}} placeholders with real data
 */
export async function resolveTemplateHtml(
  orgId: string,
  documentType: string,
  templateId?: string,
  macroValues?: Record<string, string>,
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
        console.log(`Loaded template HTML from S3: ${template.htmlContentKey} (${html.length} chars)`);
        // Preprocess the HTML for AI consumption: resolve macros with real values, strip broken images
        const scaffoldForAI = prepareTemplateScaffoldForAI(html, macroValues);
        console.log(`Template preprocessed for AI: ${scaffoldForAI.length} chars`);
        return scaffoldForAI;
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
      console.error('Failed to upload HTML to S3:', err);
      // Mark document as failed if S3 upload fails
      await updateRFPDocumentMetadata({
        projectId,
        opportunityId,
        documentId,
        updates: {
          status: 'FAILED',
          generationError: 'Failed to upload HTML content to S3',
        },
        updatedBy: 'system',
      });
      throw new Error('Failed to upload HTML content to S3');
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

  // ── Create version snapshot when document generation completes successfully ──
  if (status === 'COMPLETE' && content?.content && orgId) {
    try {
      // Get existing document for metadata (document type)
      const existingDoc = await getRFPDocument(projectId, opportunityId, documentId);
      
      const latestVersionNum = await getLatestVersionNumber(projectId, opportunityId, documentId);
      const newVersionNumber = latestVersionNum + 1;
      const htmlContentStr = content.content;

      // Save HTML to version-specific S3 location
      const versionHtmlKey = await saveVersionHtml(
        orgId,
        projectId,
        opportunityId,
        documentId,
        newVersionNumber,
        htmlContentStr,
      );

      // Create version metadata record in DynamoDB
      const versionId = uuidv4();
      await createVersion({
        versionId,
        documentId,
        projectId,
        opportunityId,
        orgId,
        versionNumber: newVersionNumber,
        htmlContentKey: versionHtmlKey,
        title: content.title ?? existingDoc?.title ?? existingDoc?.name ?? 'Generated Document',
        documentType: existingDoc?.documentType ?? 'UNKNOWN',
        wordCount: htmlContentStr.split(/\s+/).length,
        changeNote: newVersionNumber === 1 ? 'Initial AI generation' : 'AI regeneration',
        createdBy: existingDoc?.createdBy ?? 'system',
      });

      console.log(`Created version ${newVersionNumber} for document ${documentId} (AI generation)`);

    } catch (versionErr) {
      // Log but don't fail the update if version creation fails
      console.error('Failed to create version snapshot after AI generation:', versionErr);
    }
  }
}
