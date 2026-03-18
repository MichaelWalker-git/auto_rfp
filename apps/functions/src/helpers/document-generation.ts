import { v4 as uuidv4 } from 'uuid';
import { queryBySkPrefix } from '@/helpers/db';
import { updateRFPDocumentMetadata, uploadRFPDocumentHtml, getRFPDocument } from '@/helpers/rfp-document';
import { loadAllSolicitationTexts } from '@/helpers/executive-opportunity-brief';
import { getTemplate, findBestTemplate, loadTemplateHtml, replaceMacros } from '@/helpers/template';
import { MAX_SOLICITATION_CHARS } from '@/constants/document-generation';
import { QUESTION_PK } from '@/constants/question';
import {
  createVersion,
  getLatestVersionNumber,
  saveVersionHtml,
} from '@/helpers/rfp-document-version';
import type { RFPDocumentContent } from '@auto-rfp/core';
import type { BedrockResponse, QaPair } from '@/types/document-generation';
import { getProjectById } from '@/helpers/project';
import { getOrganizationById } from '@/helpers/org';
import { getOpportunity } from '@/helpers/opportunity';
import { getExecutiveBriefByProjectId } from '@/helpers/executive-opportunity-brief';

export type { QaPair };

// ─── Bedrock response parsing ───

export const extractBedrockText = (outer: BedrockResponse): string => {
  const text = outer.content?.[0]?.text?.trim();
  if (text) return text;
  if (outer.output_text?.trim()) return outer.output_text.trim();
  if (outer.completion?.trim()) return outer.completion.trim();
  return '';
};

// ─── Q&A pairs ───

export const loadQaPairs = async (projectId: string, oppId: string): Promise<QaPair[]> => {
  const items = await queryBySkPrefix<QaPair>(QUESTION_PK, `${projectId}#${oppId}`);
  return items.map(({ question, answer }) => ({ question, answer }));
};

// ─── Solicitation text ───

export const loadSolicitation = async (projectId: string, opportunityId: string): Promise<string> => {
  try {
    return await loadAllSolicitationTexts(projectId, opportunityId, MAX_SOLICITATION_CHARS);
  } catch (err) {
    console.warn('Failed to load solicitation texts:', (err as Error)?.message);
    return '';
  }
};

// ─── Macro Values ─────────────────────────────────────────────────────────────

/**
 * Format an ISO date string to a human-readable US date format.
 * Returns the original string if parsing fails.
 */
const formatDateSafe = (isoDate: string): string => {
  try {
    return new Date(isoDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return isoDate;
  }
};

/**
 * Format a number as US currency (no decimals).
 */
const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

/**
 * Format a contact object as "Name (email)" string.
 */
const formatContact = (contact?: { name?: string | null; email?: string | null }): string => {
  if (!contact) return '';
  const parts: string[] = [];
  if (contact.name) parts.push(contact.name);
  if (contact.email) parts.push(`(${contact.email})`);
  return parts.join(' ');
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

  const today = new Date();
  const macroValues: Record<string, string> = {
    // Date macros
    TODAY: today.toISOString().split('T')[0],
    CURRENT_YEAR: String(today.getFullYear()),
    CURRENT_MONTH: today.toLocaleDateString('en-US', { month: 'long' }),
    CURRENT_DAY: String(today.getDate()),
    // CONTENT macro: visible placeholder so the AI knows where to insert generated content.
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

    // Project contact info macros
    macroValues.PROJECT_POC_NAME = project.contactInfo?.primaryPocName || '';
    macroValues.PROJECT_POC_EMAIL = project.contactInfo?.primaryPocEmail || '';
    macroValues.PROJECT_POC_PHONE = project.contactInfo?.primaryPocPhone || '';
    macroValues.PROJECT_POC_TITLE = project.contactInfo?.primaryPocTitle || '';
  }

  // Opportunity macros
  if (opportunity) {
    macroValues.OPPORTUNITY_ID = opportunity.id || '';
    macroValues.NOTICE_ID = opportunity.noticeId || '';
    macroValues.SOLICITATION_NUMBER = opportunity.solicitationNumber || '';
    macroValues.OPPORTUNITY_TITLE = opportunity.title || '';

    // Agency information
    macroValues.AGENCY_NAME = opportunity.organizationName || '';
    macroValues.ISSUING_OFFICE = opportunity.organizationName || '';

    // Dates
    if (opportunity.postedDateIso) {
      macroValues.POSTED_DATE = formatDateSafe(opportunity.postedDateIso);
    }
    if (opportunity.responseDeadlineIso) {
      macroValues.RESPONSE_DEADLINE = formatDateSafe(opportunity.responseDeadlineIso);
      macroValues.SUBMISSION_DATE = macroValues.RESPONSE_DEADLINE;
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
      const formatted = typeof value === 'number' && value > 0
        ? formatCurrency(value)
        : String(value);
      macroValues.ESTIMATED_VALUE = formatted;
      macroValues.BASE_AND_OPTIONS_VALUE = formatted;
    }

    // Solicitation organization macros
    macroValues.SOLICITATION_ORG_NAME = opportunity.organizationName || '';
    macroValues.SOLICITATION_ORG_OFFICE = opportunity.organizationName || '';
  }

  // Brief contacts macros — load executive brief if opportunity is provided
  if (opportunityId) {
    try {
      const brief = await getExecutiveBriefByProjectId(projectId, opportunityId);

      // Extract solicitation org details from brief summary
      const summaryData = brief?.sections?.summary?.data;
      if (summaryData) {
        if (summaryData.office) {
          macroValues.SOLICITATION_ORG_OFFICE = summaryData.office;
        }
        if (summaryData.placeOfPerformance) {
          macroValues.SOLICITATION_ORG_LOCATION = summaryData.placeOfPerformance;
        }
        if (summaryData.agency && !macroValues.SOLICITATION_ORG_NAME) {
          macroValues.SOLICITATION_ORG_NAME = summaryData.agency;
        }
      }

      // Extract contacts from brief
      const contacts = brief?.sections?.contacts?.data?.contacts;
      if (contacts?.length) {
        const contractingOfficer = contacts.find((c) => c.role === 'CONTRACTING_OFFICER');
        const technicalPoc = contacts.find((c) => c.role === 'TECHNICAL_POC');

        macroValues.CONTRACTING_OFFICER = formatContact(contractingOfficer);
        macroValues.TECHNICAL_POC = formatContact(technicalPoc);
      }
    } catch (err) {
      console.warn('No executive brief found for opportunity:', opportunityId, (err as Error)?.message);
    }
  }

  return macroValues;
};

// ─── Template scaffold preprocessing ──────────────────────────────────────────

/**
 * Prepare a template's HTML for use as an AI scaffold:
 * 1. Replace {{MACRO}} placeholders with real values from macroValues
 * 2. Replace any remaining unresolved macros with generic labels
 * 3. Preserve s3key: image tags with marker comments
 * 4. Add a scaffold header comment
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

  // Replace {{MACRO}} placeholders with real values, then fall back to generic labels
  if (macroValues && Object.keys(macroValues).length > 0) {
    scaffold = replaceMacros(scaffold, macroValues, { removeUnresolved: false });
  }

  // Replace any remaining unresolved macros with generic human-readable labels
  // e.g. {{AGENCY_NAME}} → [Agency Name]
  scaffold = scaffold.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) =>
    `[${key.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}]`,
  );

  // Preserve image tags — add a marker comment so the AI knows to keep them untouched
  scaffold = scaffold.replace(
    /(<img[^>]*?(?:src="s3key:[^"]*"|data-s3-key="[^"]*")[^>]*?>)/gi,
    '<!-- PRESERVE THIS IMAGE TAG EXACTLY AS-IS -->$1',
  );

  // Add scaffold header based on template structure
  const hasHeadings = /<h[1-6]/i.test(scaffold);

  if (hasHeadings) {
    return `<!-- TEMPLATE SCAFFOLD: You MUST follow this exact structure. Keep ALL <h1>, <h2>, <h3> headings exactly as written. Fill in all [CONTENT] and [placeholder] markers with real, detailed content. Do NOT add extra sections or headings not in this template. -->\n${scaffold}`;
  }

  return `<!-- TEMPLATE SCAFFOLD: This template defines the document wrapper/structure. Replace [CONTENT: ...] with a complete, well-structured HTML document body including appropriate headings and paragraphs. Keep all other text and elements (dates, company name, etc.) in their original positions. -->\n${scaffold}`;
};

// ─── Template HTML resolution ─────────────────────────────────────────────────

/**
 * Resolve the HTML scaffold for a template with real macro values.
 * Loads the template's HTML content from S3 via htmlContentKey.
 * Returns null if no template is found or has no HTML content.
 *
 * @param orgId - Organization ID
 * @param documentType - Document type (e.g., 'COVER_LETTER', 'EXECUTIVE_SUMMARY')
 * @param templateId - Optional template ID. If not provided, auto-selects the best template.
 * @param macroValues - Optional macro values to replace {{MACRO}} placeholders with real data
 */
export const resolveTemplateHtml = async (
  orgId: string,
  documentType: string,
  templateId?: string,
  macroValues?: Record<string, string>,
): Promise<string | null> => {
  const template = templateId
    ? await getTemplate(orgId, templateId)
    : await findBestTemplate(orgId, documentType);

  if (!template) return null;

  if (!template.htmlContentKey) {
    console.warn(`Template "${template.name}" has no htmlContentKey — cannot load HTML content`);
    return null;
  }

  try {
    const html = await loadTemplateHtml(template.htmlContentKey);
    if (!html?.trim()) {
      console.warn(`Template HTML from S3 is empty: ${template.htmlContentKey}`);
      return null;
    }

    console.log(`Loaded template HTML from S3: ${template.htmlContentKey} (${html.length} chars)`);
    const scaffoldForAI = prepareTemplateScaffoldForAI(html, macroValues);
    console.log(`Template preprocessed for AI: ${scaffoldForAI.length} chars`);
    return scaffoldForAI;
  } catch (err) {
    console.error('Failed to load template HTML from S3:', err);
    return null;
  }
};

// ─── Document status update ──────────────────────────────────────────────────
// When status is COMPLETE and content is provided:
//   1. Upload the HTML body to S3 and store only the key in DynamoDB (htmlContentKey).
//   2. Store metadata (title, customerName, outlineSummary, opportunityId) in DynamoDB content field
//      WITHOUT the large `content` (html) string — that lives in S3.

export const updateDocumentStatus = async (
  projectId: string,
  opportunityId: string,
  documentId: string,
  status: 'COMPLETE' | 'FAILED',
  content?: RFPDocumentContent,
  generationError?: string,
  orgId?: string,
): Promise<void> => {
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

  // Safety net: if status is COMPLETE but we couldn't upload HTML to S3,
  // mark as FAILED to avoid leaving the document in an inconsistent state
  // (COMPLETE status but no htmlContentKey → "missing S3 key" error on read).
  if (status === 'COMPLETE' && !htmlContentKey) {
    const reason = !content?.content
      ? 'Document generation produced empty HTML content'
      : !orgId
        ? 'Cannot upload HTML to S3: orgId is missing'
        : 'HTML content upload to S3 was skipped unexpectedly';
    console.error(`[updateDocumentStatus] Marking document as FAILED: ${reason} (documentId=${documentId})`);
    await updateRFPDocumentMetadata({
      projectId,
      opportunityId,
      documentId,
      updates: {
        status: 'FAILED',
        generationError: reason,
      },
      updatedBy: 'system',
    });
    return;
  }

  // Build the content object stored in DynamoDB — metadata only, no HTML
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

  // Create version snapshot when document generation completes successfully
  if (status === 'COMPLETE' && content?.content && orgId) {
    try {
      const existingDoc = await getRFPDocument(projectId, opportunityId, documentId);

      const latestVersionNum = await getLatestVersionNumber(projectId, opportunityId, documentId);
      const newVersionNumber = latestVersionNum + 1;
      const htmlContentStr = content.content;

      const versionHtmlKey = await saveVersionHtml(
        orgId,
        projectId,
        opportunityId,
        documentId,
        newVersionNumber,
        htmlContentStr,
      );

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
      console.error('Failed to create version snapshot after AI generation:', versionErr);
    }
  }
};
