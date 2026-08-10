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
import { type RFPDocumentContent, type TemplateFurniture } from '@auto-rfp/core';
import type { BedrockResponse, QaPair } from '@/types/document-generation';

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
// buildMacroValues has been moved to template.ts to avoid Bedrock dependencies

// ─── Template scaffold preprocessing ──────────────────────────────────────────

/**
 * Prepare a template's HTML for use as an AI scaffold:
 * 1. Replace {{MACRO}} placeholders with real values from macroValues
 * 2. Replace any remaining unresolved macros with generic labels
 * 3. Preserve s3key: image tags with marker comments
 * 4. Preserve CSS styles and styling attributes
 * 5. Add a scaffold header comment with strong preservation instructions
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

  // Preserve CSS style blocks and link tags
  scaffold = scaffold.replace(
    /(<style[^>]*>[\s\S]*?<\/style>)/gi,
    '<!-- PRESERVE THIS STYLE BLOCK EXACTLY AS-IS -->$1',
  );

  scaffold = scaffold.replace(
    /(<link[^>]*?(?:rel="stylesheet"|type="text\/css")[^>]*?>)/gi,
    '<!-- PRESERVE THIS STYLE LINK EXACTLY AS-IS -->$1',
  );

  // Add scaffold header based on template structure with stronger preservation instructions
  const hasHeadings = /<h[1-6]/i.test(scaffold);
  const hasImages = /<!-- PRESERVE THIS IMAGE TAG/.test(scaffold);
  const hasStyles = /<!-- PRESERVE THIS STYLE/.test(scaffold);

  let instructions = 'You MUST follow this exact structure. ';
  
  if (hasHeadings) {
    instructions += 'Keep ALL <h1>, <h2>, <h3> headings exactly as written. ';
  }
  
  if (hasImages) {
    instructions += 'PRESERVE ALL IMAGE TAGS marked with preservation comments - copy them EXACTLY including all attributes. ';
  }
  
  if (hasStyles) {
    instructions += 'PRESERVE ALL STYLE BLOCKS and CSS styling marked with preservation comments - copy them EXACTLY. ';
  }
  
  instructions += 'Fill in all [CONTENT] and [placeholder] markers with real, detailed content. ';
  instructions += 'Do NOT add extra sections or headings not in this template. ';
  instructions += 'CRITICAL: Any element marked with "PRESERVE" comments must be copied exactly as-is.';

  if (hasHeadings) {
    return `<!-- TEMPLATE SCAFFOLD: ${instructions} -->\n${scaffold}`;
  }

  return `<!-- TEMPLATE SCAFFOLD: This template defines the document wrapper/structure. Replace [CONTENT: ...] with a complete, well-structured HTML document body including appropriate headings and paragraphs. Keep all other text and elements (dates, company name, images, styles) in their original positions. PRESERVE ALL marked elements exactly as-is. -->\n${scaffold}`;
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

/**
 * Resolve the header/footer configuration for a generated document.
 *
 * Exports run on documents rather than templates, and an `RFPDocumentItem` has no
 * link back to the template it came from, so the furniture has to be snapshotted
 * onto the document at generation time or the export path can never see it.
 *
 * Snapshotting (rather than looking the template up at export time) also means a
 * later template edit cannot retroactively restyle documents already produced.
 *
 * Uses the same template resolution as `resolveTemplateHtml` so the furniture
 * always comes from the template that supplied the body.
 */
export const resolveTemplateFurniture = async (
  orgId: string,
  documentType: string,
  templateId?: string,
): Promise<{ templateId?: string; furniture?: TemplateFurniture }> => {
  try {
    const template = templateId
      ? await getTemplate(orgId, templateId)
      : await findBestTemplate(orgId, documentType);

    if (!template) return {};
    return { templateId: template.id, furniture: template.furniture };
  } catch (err) {
    // Never fail generation over furniture — a document without a header is far
    // better than no document.
    console.warn('Failed to resolve template furniture:', (err as Error)?.message);
    return {};
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
  status: 'READY' | 'FAILED',
  content?: RFPDocumentContent,
  generationError?: string,
  orgId?: string,
): Promise<void> => {
  let htmlContentKey: string | undefined;

  // Upload HTML to S3 when we have content and an orgId to build the key
  if (status === 'READY' && content?.content && orgId) {
    try {
      console.log(`[updateDocumentStatus] Uploading HTML to S3: ${content.content.length} chars`);
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
  if (status === 'READY' && !htmlContentKey) {
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
  if (status === 'READY' && content?.content && orgId) {
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

// ─── Content Validation ──────────────────────────────────────────────────────
// Detects empty, placeholder-only, or too-short generated content.

export interface ContentValidationResult {
  isValid: boolean;
  reason?: string;
}

/** Minimum character count for valid document content (after stripping HTML and placeholders) */
const MIN_CONTENT_LENGTH = 100;

/**
 * Validate that generated HTML content is not empty or placeholder-only.
 * Returns { isValid: false, reason: "..." } if content is invalid.
 */
export const validateGeneratedContent = (html: string | null | undefined): ContentValidationResult => {
  if (!html?.trim()) {
    return { isValid: false, reason: 'Document content is completely empty' };
  }

  // Strip HTML tags
  let text = html.replace(/<[^>]*>/g, '');

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Check 1: Completely empty after stripping HTML
  if (!text) {
    return { isValid: false, reason: 'Document contains only HTML tags with no text content' };
  }

  // Check 2: Remove unresolved placeholders and check what remains
  const withoutPlaceholders = text
    // {{MACRO}} style placeholders
    .replace(/\{\{[A-Z_]+\}\}/g, '')
    // [CONTENT: ...] style placeholders
    .replace(/\[CONTENT:[^\]]*\]/gi, '')
    // [placeholder] markers
    .replace(/\[placeholder\]/gi, '')
    // [Your ...] markers from templates
    .replace(/\[Your [^\]]*\]/gi, '')
    // Normalize again after removals
    .replace(/\s+/g, ' ')
    .trim();

  if (!withoutPlaceholders) {
    return { isValid: false, reason: 'Document only contains unresolved placeholders' };
  }

  // Check 3: Content too short (just title or minimal text)
  if (withoutPlaceholders.length < MIN_CONTENT_LENGTH) {
    return {
      isValid: false,
      reason: `Document content too short (${withoutPlaceholders.length} chars, minimum ${MIN_CONTENT_LENGTH})`,
    };
  }

  return { isValid: true };
};

// ─── Retry Logic ─────────────────────────────────────────────────────────────

// MAX_GENERATION_RETRIES is imported from @auto-rfp/core (see import at top of file)

/** Base delay for retry attempts in seconds (used for exponential backoff) */
export const RETRY_BASE_DELAY_SECONDS = 30;

/** Maximum delay for retry attempts in seconds (cap for exponential backoff) */
export const RETRY_MAX_DELAY_SECONDS = 120;

/**
 * Calculate delay for a retry attempt using exponential backoff.
 * retryCount 1 → 30s, retryCount 2 → 60s, retryCount 3 → 120s (capped)
 */
export const calculateRetryDelay = (retryCount: number): number => {
  const exponentialDelay = RETRY_BASE_DELAY_SECONDS * Math.pow(2, retryCount - 1);
  return Math.min(exponentialDelay, RETRY_MAX_DELAY_SECONDS);
};

/**
 * @deprecated Use calculateRetryDelay() for exponential backoff
 */
export const RETRY_DELAY_SECONDS = 30;

export interface DocumentGenerationMessage {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentType: string;
  templateId?: string;
  documentId: string;
  options?: Record<string, unknown>;
}
