/**
 * Helpers for the RFP Document Generation SQS Worker.
 *
 * Contains the generation strategies and utility functions used by the worker handler.
 * Supports two generation strategies:
 *
 * 1. **Template section-by-section** — Parse template into <h2> sections, generate each
 *    independently with AI + tools, then merge back into template structure.
 *
 * 2. **Single-shot** — Generate the entire document in one AI conversation with a
 *    tool-use loop (up to MAX_TOOL_ROUNDS iterations).
 */

import { z } from 'zod';

import { safeParseJsonFromModel } from '@/helpers/json';
import { gatherAllContext } from '@/helpers/document-context';
import {
  buildSystemPromptForDocumentType,
  buildSectionSystemPrompt,
  buildUserPromptForDocumentType,
} from '@/helpers/document-prompts';
import {
  extractBedrockText,
  loadQaPairs,
  loadSolicitation,
  resolveTemplateHtml,
  buildMacroValues,
  type QaPair,
} from '@/helpers/document-generation';
import { getTemplate, findBestTemplate, loadTemplateHtml, replaceMacros } from '@/helpers/template';
import { uploadRFPDocumentHtml, updateRFPDocumentMetadata } from '@/helpers/rfp-document';
import {
  createVersion,
  getLatestVersionNumber,
  saveVersionHtml,
} from '@/helpers/rfp-document-version';
import { v4 as uuidv4 } from 'uuid';
import { getRFPDocument } from '@/helpers/rfp-document';
import { BEDROCK_MODEL_ID, MAX_TOKENS, TEMPERATURE } from '@/constants/document-generation';
import { RFPDocumentContentSchema, RFPDocumentTypeSchema, type RFPDocumentContent } from '@auto-rfp/core';
import { DOCUMENT_TOOLS, executeDocumentTool } from '@/helpers/document-tools';
import { invokeModel } from '@/helpers/bedrock-http-client';
import {
  generateDocumentSectionBySectionHtml,
  buildDocumentTitleHtml,
} from '@/helpers/document-section-generator';
import {
  parseTemplateSections,
  injectSectionsIntoTemplate,
  injectContentIntoSimpleTemplate,
} from '@/helpers/template-section-parser';

// ─── Schema & Types ───────────────────────────────────────────────────────────

export const JobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentType: RFPDocumentTypeSchema,
  templateId: z.string().optional(),
  documentId: z.string().min(1),
  /** Optional export options for CLARIFYING_QUESTIONS document type */
  options: z.record(z.unknown()).optional(),
});

export type Job = z.infer<typeof JobSchema>;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Document types that typically produce large table-heavy content */
const TABLE_HEAVY_TYPES = new Set(['COMPLIANCE_MATRIX', 'APPENDICES', 'PAST_PERFORMANCE', 'CERTIFICATIONS']);

/** Maximum tool-use rounds for single-shot generation */
const MAX_TOOL_ROUNDS = 5;

// ─── HTML Helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize the model response: the AI returns `htmlContent` but the schema
 * canonical field is `content`. Merge them so downstream code always uses `content`.
 * Also generates a minimal HTML fallback if neither field has content.
 */
export const ensureHtmlContent = (doc: RFPDocumentContent, templateHtml?: string): RFPDocumentContent => {
  const effectiveContent = doc.content || doc.htmlContent || null;

  if (effectiveContent) {
    return { ...doc, content: effectiveContent, htmlContent: undefined };
  }

  console.warn('Model did not return htmlContent — generating minimal HTML fallback');

  const titleHtml = buildDocumentTitleHtml(doc.title, templateHtml);
  const html = [
    titleHtml,
    doc.outlineSummary
      ? `<p style="margin:0 0 1em;line-height:1.7">${doc.outlineSummary}</p>`
      : '',
  ].filter(Boolean).join('\n');

  return { ...doc, content: html, htmlContent: undefined };
};

/**
 * Build a minimal default template for document types that don't have a custom template.
 * Uses a simple {{CONTENT}} placeholder so the AI generates the full document body.
 */
export const buildDefaultTemplate = (): string =>
  `<!-- TEMPLATE SCAFFOLD: This template defines the document wrapper/structure. Replace [CONTENT: ...] with a complete, well-structured HTML document body including appropriate headings and paragraphs. Keep all other text and elements (dates, company name, etc.) in their original positions. -->
<p style="margin:0 0 1em;line-height:1.7">[CONTENT: Write the complete document content here based on the solicitation requirements and provided context. Include appropriate headings, sections, and structure.]</p>`;

/**
 * Extract a clean document title from template HTML.
 * Falls back to formatting the document type as a title.
 */
export const extractDocumentTitle = (templateHtml: string, documentType: string): string => {
  const titleMatch = templateHtml.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const rawTitle = titleMatch ? titleMatch[1] : null;

  if (rawTitle) {
    const cleaned = rawTitle
      .replace(/<[^>]+>/g, '')           // Remove HTML tags
      .replace(/\{\{[A-Z0-9_]+\}\}/g, '') // Remove unresolved macros
      .replace(/\[[^\]]+\]/g, '')         // Remove [placeholder] text
      .trim();
    if (cleaned) return cleaned;
  }

  return documentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Clean generated HTML: strip scaffold comments while preserving template elements.
 * IMPORTANT: Only strips well-formed (closed) HTML comments to avoid eating template content.
 * Does NOT strip [CONTENT: ...] placeholders — those are handled during template injection.
 * Does NOT replace \\n or \\t — those are JSON escape artifacts that should be handled
 * during JSON parsing, not in HTML post-processing.
 * 
 * Validates that preserved elements (images, styles) are still present after generation.
 */
export const cleanGeneratedHtml = (html: string): string => {
  if (!html?.trim()) return html;

  // Count preserved elements before cleaning for validation
  const imageCount = (html.match(/<!-- PRESERVE THIS IMAGE TAG EXACTLY AS-IS -->/gi) || []).length;
  const styleBlockCount = (html.match(/<!-- PRESERVE THIS STYLE BLOCK EXACTLY AS-IS -->/gi) || []).length;
  const styleLinkCount = (html.match(/<!-- PRESERVE THIS STYLE LINK EXACTLY AS-IS -->/gi) || []).length;
  const styledElementCount = (html.match(/<!-- PRESERVE STYLING -->/gi) || []).length;

  // Count actual preserved elements (images with s3key, style blocks, etc.)
  const actualImages = (html.match(/<img[^>]*?(?:src="s3key:[^"]*"|data-s3-key="[^"]*")[^>]*?>/gi) || []).length;
  const actualStyleBlocks = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).length;
  const actualStyleLinks = (html.match(/<link[^>]*?(?:rel="stylesheet"|type="text\/css")[^>]*?>/gi) || []).length;

  // Log validation results
  if (imageCount > 0) {
    console.log(`[cleanGeneratedHtml] Image preservation: ${actualImages}/${imageCount} images preserved`);
    if (actualImages < imageCount) {
      console.warn(`[cleanGeneratedHtml] WARNING: ${imageCount - actualImages} images were lost during generation`);
    }
  }

  if (styleBlockCount > 0) {
    console.log(`[cleanGeneratedHtml] Style block preservation: ${actualStyleBlocks}/${styleBlockCount} style blocks preserved`);
    if (actualStyleBlocks < styleBlockCount) {
      console.warn(`[cleanGeneratedHtml] WARNING: ${styleBlockCount - actualStyleBlocks} style blocks were lost during generation`);
    }
  }

  if (styleLinkCount > 0) {
    console.log(`[cleanGeneratedHtml] Style link preservation: ${actualStyleLinks}/${styleLinkCount} style links preserved`);
    if (actualStyleLinks < styleLinkCount) {
      console.warn(`[cleanGeneratedHtml] WARNING: ${styleLinkCount - actualStyleLinks} style links were lost during generation`);
    }
  }

  const cleaned = html
    // Strip well-formed scaffold comments (properly terminated with -->)
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[\s\S]*?-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS IMAGE TAG EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE BLOCK EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE LINK EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE STYLING\s*-->\s*/gi, '')
    .replace(/<!--\s*Section guidance:[\s\S]*?-->\s*/gi, '')
    // Strip unclosed scaffold comments (no --> terminator) — strip from <!-- to end of line
    // Critical: an unclosed <!-- makes the browser hide all content after it
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE THIS IMAGE TAG[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE STYLING[^\n]*\n?/gi, '')
    .replace(/<!--\s*Section guidance:[^\n]*\n?/gi, '');

  return cleaned;
};

// ─── Template-Based Section Generation ────────────────────────────────────────

/**
 * Generate a document using the template section-by-section strategy.
 *
 * This is the PRIMARY generation path when a template with <h2> sections exists.
 *
 * Flow:
 * 1. Parse template into sections (split on <h2> headings)
 * 2. Generate each section independently with AI + tools
 * 3. Merge generated sections into the final document
 * 4. Clean and return the final HTML
 */
export const generateWithTemplateSections = async (args: {
  templateHtml: string;
  systemPrompt: string;
  sectionSystemPrompt: string;
  userPrompt: string;
  documentType: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  qaPairs: QaPair[];
}): Promise<RFPDocumentContent | null> => {
  const { templateHtml, sectionSystemPrompt, userPrompt, documentType, orgId, projectId, opportunityId, documentId, qaPairs } = args;

  // 1. Parse template into sections
  const templateSections = parseTemplateSections(templateHtml);
  if (!templateSections || templateSections.length === 0) {
    console.log(`[template-gen] Template has no sections — falling back to single-shot generation`);
    return null; // Fall through to single-shot
  }

  // Check if any section has placeholders that need AI generation.
  // If no section has placeholders, fall back to single-shot so the AI generates
  // actual content for the document type instead of just returning the template.
  const anySectionHasPlaceholders = templateSections.some(s =>
    s.templateContent && /\[CONTENT:|\[placeholder\]|\[Your /i.test(s.templateContent),
  );
  if (!anySectionHasPlaceholders) {
    console.log(`[template-gen] No sections have placeholders — falling back to single-shot generation`);
    return null; // Fall through to single-shot
  }

  console.log(`[template-gen] Using section-by-section generation: ${templateSections.length} sections from template`);
  console.log(`[template-gen] Sections:`, JSON.stringify(templateSections.map(s => ({ title: s.title, description: s.description })), null, 2));

  // 2. Generate each section independently with AI + tools
  const htmlFragments = await generateDocumentSectionBySectionHtml({
    modelId: BEDROCK_MODEL_ID,
    systemPrompt: sectionSystemPrompt,
    initialUserPrompt: userPrompt,
    sections: templateSections,
    orgId,
    projectId,
    opportunityId,
    documentId,
    qaPairs,
    maxTokensPerSection: 6000,
    temperature: TEMPERATURE,
    maxToolRoundsPerSection: 2,
  });

  if (!htmlFragments.length) {
    console.error(`[template-gen] Section-by-section generation produced no content`);
    return null;
  }

  // 3. Merge sections back into template structure
  const rawStitchedHtml = injectSectionsIntoTemplate(templateHtml, htmlFragments);
  const stitchedHtml = cleanGeneratedHtml(rawStitchedHtml);

  // 4. Extract title and build final document
  const docTitle = extractDocumentTitle(templateHtml, documentType);

  console.log(`[template-gen] Section-by-section complete: ${htmlFragments.length} sections, ${stitchedHtml.length} chars total`);

  return {
    title: docTitle,
    content: stitchedHtml,
  };
};

// ─── Single-Shot Generation (with tool-use loop) ─────────────────────────────

/**
 * Generate a document using a single AI conversation with tool-use loop.
 *
 * Used when:
 * - Template is a simple wrapper (no <h2> sections, just {{CONTENT}} placeholder)
 * - No template exists (uses default template)
 *
 * The AI generates the entire document in one conversation, with up to
 * MAX_TOOL_ROUNDS of tool-use iterations to gather context.
 */
export const generateSingleShot = async (args: {
  templateHtml: string;
  systemPrompt: string;
  userPrompt: string;
  documentType: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  qaPairs: QaPair[];
  enrichedKbTextLength: number;
}): Promise<RFPDocumentContent | null> => {
  const { templateHtml, systemPrompt, userPrompt, documentType, orgId, projectId, opportunityId, documentId, qaPairs, enrichedKbTextLength } = args;

  console.log(`[single-shot] Using single-shot generation with template scaffold (${templateHtml.length} chars)`);

  const baseMaxTokens = TABLE_HEAVY_TYPES.has(documentType) ? Math.max(MAX_TOKENS, 16000) : MAX_TOKENS;
  const effectiveMaxTokens = enrichedKbTextLength > 1000 ? Math.max(baseMaxTokens, 8000) : baseMaxTokens;

  const messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: [{ type: 'text', text: userPrompt }] },
  ];

  let rawText = '';
  let toolRounds = 0;

  while (toolRounds <= MAX_TOOL_ROUNDS) {
    const isLastRound = toolRounds >= MAX_TOOL_ROUNDS;

    const requestBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: systemPrompt }],
      messages,
      max_tokens: effectiveMaxTokens,
      temperature: TEMPERATURE,
    };

    if (!isLastRound) {
      requestBody.tools = DOCUMENT_TOOLS;
    }

    const responseBody = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(requestBody));
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody));

    const stopReason: string = parsed.stop_reason ?? 'end_turn';
    const content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }> =
      parsed.content ?? [];

    if (stopReason === 'tool_use' && !isLastRound) {
      const toolUseBlocks = content.filter(c => c.type === 'tool_use');
      console.log(`[single-shot] Tool use round ${toolRounds + 1}: ${toolUseBlocks.length} tool call(s)`);

      messages.push({ role: 'assistant', content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(block =>
          executeDocumentTool({
            toolName: block.name ?? '',
            toolInput: (block.input ?? {}) as Record<string, unknown>,
            toolUseId: block.id ?? '',
            orgId,
            projectId,
            opportunityId,
            documentId,
            qaPairs,
          }),
        ),
      );

      messages.push({
        role: 'user',
        content: toolResults.map(r => ({
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          content: r.content,
        })),
      });

      toolRounds++;
      continue;
    }

    rawText = content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n')
      .trim();

    if (!rawText) {
      rawText = extractBedrockText(parsed);
    }

    // If last round still returned tool_use, force a final generation request
    if (!rawText && stopReason === 'tool_use' && isLastRound) {
      console.warn('[single-shot] Last round still returned tool_use — sending final generation request without tools');
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Now generate the complete document JSON based on all the information gathered.' }],
      });
      const finalBody = {
        anthropic_version: 'bedrock-2023-05-31',
        system: [{ type: 'text', text: systemPrompt }],
        messages,
        max_tokens: effectiveMaxTokens,
        temperature: TEMPERATURE,
      };
      const finalResponse = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(finalBody));
      const finalParsed = JSON.parse(new TextDecoder('utf-8').decode(finalResponse));
      const finalContent: Array<{ type: string; text?: string }> = finalParsed.content ?? [];
      rawText = finalContent.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n').trim()
        || extractBedrockText(finalParsed);
    }

    console.log(`[single-shot] Generation complete after ${toolRounds} tool round(s), ${rawText.length} chars`);
    break;
  }

  // Parse model JSON — with fallback for plain-text/HTML responses
  let modelJson: unknown;
  try {
    modelJson = safeParseJsonFromModel(rawText);

    // Check if the model returned a JSON structure as text instead of structured data
    if (typeof modelJson === 'object' && modelJson !== null) {
      const obj = modelJson as Record<string, unknown>;
      const htmlField = obj.htmlContent || obj.content;
      if (typeof htmlField === 'string' && htmlField.trim().startsWith('{')) {
        try {
          const innerParsed = JSON.parse(htmlField);
          if (innerParsed && typeof innerParsed === 'object' && (innerParsed.content || innerParsed.htmlContent)) {
            console.warn('[single-shot] Detected JSON-as-text in content field, extracting actual HTML');
            modelJson = innerParsed;
          }
        } catch {
          // Not valid JSON, continue with the original
        }
      }
    }
  } catch (parseErr) {
    console.warn(`[single-shot] safeParseJsonFromModel failed: ${(parseErr as Error).message}. Wrapping raw text as HTML.`);
    modelJson = { title: 'Generated Document', htmlContent: rawText };
  }

  // Validate model output against RFPDocumentContent schema
  const { success, data, error } = RFPDocumentContentSchema.safeParse(modelJson);
  if (!success) {
    console.error('[single-shot] Document validation failed', error, { modelJson });
    return null;
  }

  // Ensure htmlContent is present
  const normalizedDocument = ensureHtmlContent(data, templateHtml);

  let finalHtml = normalizedDocument.content ?? '';
  console.log(`[single-shot] After ensureHtmlContent: ${finalHtml.length} chars`);

  // For real templates, inject the AI-generated content into the template to
  // preserve images, logos, styles, and boilerplate.
  // Only do this for real templates — not the default template (which is just a scaffold).
  const isDefaultTemplate = templateHtml.length < 500; // Default template is ~350 chars

  if (!isDefaultTemplate) {
    // Strategy 1: Template has [CONTENT: ...] placeholder — inject into that placeholder
    const templateHasContentPlaceholder = /\[CONTENT:\s*[^\]]*\]/i.test(templateHtml);
    if (templateHasContentPlaceholder) {
      console.log('[single-shot] Real template with [CONTENT: ...] placeholder — injecting AI content into template');
      const injected = injectContentIntoSimpleTemplate(templateHtml, finalHtml);
      if (injected) {
        finalHtml = injected;
        console.log(`[single-shot] Injected content into template (${finalHtml.length} chars)`);
      } else {
        console.warn('[single-shot] injectContentIntoSimpleTemplate returned null, using AI output as-is');
      }
    } else {
      // Strategy 2: Template has no [CONTENT: ...] placeholder but has structure (h1, images, styles).
      // The AI should have generated content following the template structure.
      // Check if the AI output already contains the template's key elements (images, styles).
      // If not, prepend the template's header content (before first h2) to preserve images/styles.
      const templateHasImages = /<img[^>]*(?:src="s3key:|data-s3-key=")[^>]*>/i.test(templateHtml);
      const templateHasStyles = /<style[^>]*>/i.test(templateHtml);
      const aiOutputHasImages = /<img[^>]*(?:src="s3key:|data-s3-key=")[^>]*>/i.test(finalHtml);
      const aiOutputHasStyles = /<style[^>]*>/i.test(finalHtml);

      if ((templateHasImages && !aiOutputHasImages) || (templateHasStyles && !aiOutputHasStyles)) {
        console.log('[single-shot] AI output missing template images/styles — prepending template header');
        // Extract content before first h2 from template (header with images, styles, h1)
        const firstH2Match = templateHtml.match(/<h2[^>]*>/i);
        if (firstH2Match?.index && firstH2Match.index > 0) {
          const templateHeader = templateHtml.substring(0, firstH2Match.index).trim();
          if (templateHeader) {
            finalHtml = templateHeader + '\n\n' + finalHtml;
            console.log(`[single-shot] Prepended template header (${templateHeader.length} chars)`);
          }
        }
      }
    }
  }

  finalHtml = cleanGeneratedHtml(finalHtml);

  return {
    ...normalizedDocument,
    content: finalHtml,
  };
};

// ─── Process Job (Core Logic) ─────────────────────────────────────────────────

/**
 * Core job processing logic for document generation.
 *
 * Decision tree for generation strategy:
 *   1. CLARIFYING_QUESTIONS → No AI, format existing data
 *   2. Template with <h2> sections (>1 section) → Section-by-section generation
 *   3. Template with {{CONTENT}} placeholder → Single-shot + inject into template
 *   4. No template → Single-shot with default template
 */
export const processJobInner = async (job: Job): Promise<void> => {
  const { orgId, projectId, opportunityId, documentType, templateId, documentId, options } = job;

  // ─── CLARIFYING_QUESTIONS: No AI — format existing data ───
  if (documentType === 'CLARIFYING_QUESTIONS') {
    const { generateClarifyingQuestionsDocument } = await import('@/helpers/clarifying-questions-document');
    await generateClarifyingQuestionsDocument({
      orgId,
      projectId,
      opportunityId,
      documentId,
      templateId,
      options: options as Parameters<typeof generateClarifyingQuestionsDocument>[0]['options'],
    });
    return;
  }

  // ─── Step 1: Load Q&A pairs ───
  const qaPairs = await loadQaPairs(projectId, opportunityId);

  // ─── Step 2: Load solicitation text ───
  const solicitation = await loadSolicitation(projectId, opportunityId);

  // ─── Step 3: Build macro values from real project/org/opportunity data ───
  const macroValues = await buildMacroValues({ orgId, projectId, opportunityId });
  console.log(`Built macro values for documentId=${documentId}:`, Object.keys(macroValues));

  // ─── Step 4: Gather enrichment context + resolve template HTML in parallel ───
  const [enrichedKbText, templateHtmlScaffold] = await Promise.all([
    gatherAllContext({ projectId, orgId, opportunityId, solicitation, documentType }),
    resolveTemplateHtml(orgId, documentType, templateId, macroValues),
  ]);

  if (templateHtmlScaffold) {
    console.log(`Using HTML template scaffold for documentId=${documentId} (${templateHtmlScaffold.length} chars)`);
  }

  // ─── Step 4b: Load ORIGINAL template HTML (without scaffold preprocessing) ───
  // This is used for the final document assembly to guarantee all template elements
  // (images, styles, structure) are preserved exactly as-is.
  // The scaffold version (templateHtmlScaffold) is only for the AI to see the structure.
  let originalTemplateHtml: string | null = null;
  if (templateHtmlScaffold) {
    try {
      const template = templateId
        ? await getTemplate(orgId, templateId)
        : await findBestTemplate(orgId, documentType);
      if (template?.htmlContentKey) {
        const rawHtml = await loadTemplateHtml(template.htmlContentKey);
        if (rawHtml?.trim()) {
          // Apply macro replacements to the original template (resolve {{COMPANY_NAME}} etc.)
          // but do NOT add scaffold comments or preservation markers
          originalTemplateHtml = replaceMacros(rawHtml, macroValues, { removeUnresolved: false });
          // Replace remaining unresolved macros with readable labels
          originalTemplateHtml = originalTemplateHtml.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_: string, key: string) =>
            `[${key.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}]`,
          );
          console.log(`[worker] Loaded original template HTML: ${originalTemplateHtml.length} chars (for final assembly)`);
        }
      }
    } catch (err) {
      console.warn(`[worker] Failed to load original template HTML: ${(err as Error).message}`);
    }
  }

  // ─── Step 5: Build prompts ───
  const systemPrompt = buildSystemPromptForDocumentType(documentType, templateHtmlScaffold);
  const userPrompt = buildUserPromptForDocumentType(
    documentType,
    solicitation,
    JSON.stringify(qaPairs),
    enrichedKbText,
  );

  console.log(`Prompt sizes: system=${systemPrompt.length}, user=${userPrompt.length}, solicitation=${solicitation.length}, qaPairs=${qaPairs.length}, enrichedKb=${enrichedKbText.length}`);

  if (!userPrompt.trim() || !systemPrompt.trim()) {
    await updateRFPDocumentMetadata({
      projectId, opportunityId, documentId,
      updates: { status: 'FAILED', generationError: 'Prompt generation failed' },
      updatedBy: 'system',
    });
    return;
  }

  // ─── Step 6: Choose generation strategy ───
  const effectiveTemplate = templateHtmlScaffold || buildDefaultTemplate();
  if (!templateHtmlScaffold) {
    console.warn(`No template found for documentId=${documentId}, type=${documentType} — using default template`);
  }

  let finalDocument: RFPDocumentContent | null = null;

  // Strategy 1: Section-by-section generation (template with headings AND placeholders)
  if (templateHtmlScaffold) {
    const sectionSystemPrompt = buildSectionSystemPrompt(documentType);
    console.log(`Section system prompt: ${sectionSystemPrompt.length} chars`);

    finalDocument = await generateWithTemplateSections({
      templateHtml: effectiveTemplate,
      systemPrompt,
      sectionSystemPrompt,
      userPrompt,
      documentType,
      orgId,
      projectId,
      opportunityId,
      documentId,
      qaPairs,
    });
  }

  // Strategy 2: Single-shot generation (template without h2 sections, or no template)
  // When a template exists but has no <h2> sections, we still pass it to the AI
  // so it can preserve images, logos, styles, and boilerplate from the template.
  if (!finalDocument) {
    const singleShotTemplate = templateHtmlScaffold || buildDefaultTemplate();
    // Pass the template scaffold to the system prompt so the AI sees the template structure
    const singleShotSystemPrompt = buildSystemPromptForDocumentType(documentType, templateHtmlScaffold ?? null);

    console.log(`[worker] Using single-shot generation for documentId=${documentId} (template: ${templateHtmlScaffold ? 'yes' : 'default'})`);
    finalDocument = await generateSingleShot({
      templateHtml: singleShotTemplate,
      systemPrompt: singleShotSystemPrompt,
      userPrompt,
      documentType,
      orgId,
      projectId,
      opportunityId,
      documentId,
      qaPairs,
      enrichedKbTextLength: enrichedKbText.length,
    });
  }

  // ─── Step 6b: Final assembly — use ORIGINAL template as wrapper ───
  // When a template exists, the final document MUST use the original template
  // as a wrapper to guarantee all template elements (images, styles, structure)
  // are preserved exactly as-is. The AI-generated content is injected into the
  // template structure.
  if (finalDocument?.content && originalTemplateHtml) {
    const aiContent = cleanGeneratedHtml(finalDocument.content);
    
    // Find the first heading of ANY level (h1-h6) in the original template
    const firstHeadingMatch = originalTemplateHtml.match(/<h[1-6][^>]*>/i);
    
    // HEADER: everything before the first heading (images, styles, logos, etc.)
    const templateHeader = firstHeadingMatch?.index && firstHeadingMatch.index > 0
      ? originalTemplateHtml.substring(0, firstHeadingMatch.index).trim()
      : '';
    
    // FOOTER: Find template content that the AI didn't generate.
    // Count headings in AI content vs template to detect missing sections.
    const aiHeadingCount = (aiContent.match(/<h[1-6][^>]*>/gi) || []).length;
    const templateHeadings = [...originalTemplateHtml.matchAll(/<h[1-6][^>]*>/gi)];
    const templateHeadingCount = templateHeadings.length;
    let templateFooter = '';
    
    console.log(`[worker] Heading count: AI=${aiHeadingCount}, template=${templateHeadingCount}`);
    
    if (templateHeadingCount > aiHeadingCount && aiHeadingCount > 0) {
      // Template has more headings than AI generated — append the missing sections
      // The missing sections start from the (aiHeadingCount)th heading in the template
      // (accounting for the header heading which is already in the template header)
      const headerHeadingCount = templateHeader ? (templateHeader.match(/<h[1-6][^>]*>/gi) || []).length : 0;
      const aiBodyHeadingCount = aiHeadingCount; // headings in AI body (after header strip)
      const expectedTemplateBodyHeadings = templateHeadingCount - headerHeadingCount;
      
      if (aiBodyHeadingCount < expectedTemplateBodyHeadings) {
        // Find the (aiBodyHeadingCount + headerHeadingCount)th heading in the template
        const missingFromIdx = aiBodyHeadingCount + headerHeadingCount;
        if (missingFromIdx < templateHeadings.length) {
          const missingStart = templateHeadings[missingFromIdx]!.index!;
          templateFooter = originalTemplateHtml.substring(missingStart).trim();
          console.log(`[worker] Found ${expectedTemplateBodyHeadings - aiBodyHeadingCount} missing template sections as footer: ${templateFooter.length} chars`);
        }
      }
    }
    
    // Fallback: Find the last heading in the AI content, locate it in the template,
    // and take everything from the template after that heading's section as footer.
    if (!templateFooter) {
      const aiLastHeadingMatch = [...aiContent.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
      if (aiLastHeadingMatch.length > 0) {
        const lastAiHeadingText = aiLastHeadingMatch[aiLastHeadingMatch.length - 1]![1]!
          .replace(/<[^>]+>/g, '').trim().substring(0, 50).toLowerCase();
        
        // Find this heading in the original template
        const templateAllHeadings = [...originalTemplateHtml.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
        for (let hi = templateAllHeadings.length - 1; hi >= 0; hi--) {
          const tplHeadingText = templateAllHeadings[hi]![1]!.replace(/<[^>]+>/g, '').trim().substring(0, 50).toLowerCase();
          if (tplHeadingText === lastAiHeadingText) {
            // Found the matching heading — check if there are more headings after it
            if (hi < templateAllHeadings.length - 1) {
              // There are more template headings after the last AI heading
              const nextTplHeading = templateAllHeadings[hi + 1]!;
              templateFooter = originalTemplateHtml.substring(nextTplHeading.index!).trim();
              console.log(`[worker] Found template tail after last AI heading: ${templateFooter.length} chars (${templateAllHeadings.length - hi - 1} extra sections)`);
            }
            break;
          }
        }
      }
    }
    
    // Last resort: check for any content after the very last closing tag
    if (!templateFooter) {
      const lastCloseTag = originalTemplateHtml.lastIndexOf('</');
      if (lastCloseTag >= 0) {
        const closeEnd = originalTemplateHtml.indexOf('>', lastCloseTag);
        if (closeEnd >= 0) {
          const afterLastTag = originalTemplateHtml.substring(closeEnd + 1).trim();
          if (afterLastTag) {
            templateFooter = afterLastTag;
            console.log(`[worker] Found content after last closing tag: ${templateFooter.length} chars`);
          }
        }
      }
    }
    
    // BODY: Use AI content, but strip any header the AI generated
    // (we use the template header instead to preserve images/styles)
    let aiBody = aiContent;
    if (templateHeader) {
      // Find the first heading in AI content and strip everything before it
      const aiFirstHeading = aiBody.match(/<h[1-6][^>]*>/i);
      if (aiFirstHeading?.index && aiFirstHeading.index > 0) {
        aiBody = aiBody.substring(aiFirstHeading.index);
        console.log(`[worker] Stripped AI header, using template header instead`);
      }
    }
    
    // ASSEMBLE: template header + AI body + template footer
    let assembled = '';
    if (templateHeader) {
      assembled += templateHeader + '\n\n';
    }
    assembled += aiBody;
    if (templateFooter) {
      assembled += '\n\n' + templateFooter;
    }
    
    console.log(`[worker] Final assembly: header(${templateHeader.length}) + body(${aiBody.length}) + footer(${templateFooter.length}) = ${assembled.length} chars`);
    finalDocument = { ...finalDocument, content: assembled };

    // Apply original template inline styles to ALL elements in the generated document.
    // This ensures the AI-generated content matches the template's visual design.
    let styledContent = finalDocument.content;
    
    // Collect all unique element styles from the original template.
    // TipTap stores styles in two ways:
    // 1. Inline style on the element: <h2 style="color: blue">
    // 2. Span with style inside the element: <h2><span style="color: blue">Title</span></h2>
    const styleMap = new Map<string, string>();
    
    // Pattern 1: Direct inline styles on elements
    const directStyleRegex = /<(h[1-6]|p|ul|ol|li|strong|em|a|td|th|table)\s+[^>]*style="([^"]*)"[^>]*>/gi;
    let styleMatch: RegExpExecArray | null;
    while ((styleMatch = directStyleRegex.exec(originalTemplateHtml)) !== null) {
      const tag = styleMatch[1]!.toLowerCase();
      if (!styleMap.has(tag)) {
        styleMap.set(tag, styleMatch[2]!);
      }
    }
    
    // Pattern 2: TipTap color spans inside headings (e.g., <h2><span style="color: #1e40af">Title</span></h2>)
    // Extract the span style and apply it as the heading style
    const spanInHeadingRegex = /<(h[1-6])[^>]*>\s*<span\s+[^>]*style="([^"]*)"[^>]*>/gi;
    while ((styleMatch = spanInHeadingRegex.exec(originalTemplateHtml)) !== null) {
      const tag = styleMatch[1]!.toLowerCase();
      if (!styleMap.has(tag)) {
        styleMap.set(tag, styleMatch[2]!);
        console.log(`[worker] Found TipTap span style for ${tag}: "${styleMatch[2]}"`);
      }
    }
    
    // Apply collected styles to matching elements in the generated content
    for (const [tag, style] of styleMap) {
      if (tag.startsWith('h')) {
        // For headings: replace ALL styles (even AI-generated ones) with template style
        styledContent = styledContent?.replace(
          new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi'),
          (match, attrs) => {
            if (attrs && attrs.includes(style)) return match;
            const cleanAttrs = (attrs || '').replace(/\s*style="[^"]*"/gi, '').trim();
            const space = cleanAttrs ? ' ' : '';
            return `<${tag} style="${style}"${space}${cleanAttrs}>`;
          },
        );
      } else {
        // For other elements: only apply to those without existing style
        styledContent = styledContent?.replace(
          new RegExp(`<${tag}(?![^>]*style=)(\\s[^>]*)?>`, 'gi'),
          (match, attrs) => {
            const cleanAttrs = (attrs || '').trim();
            const space = cleanAttrs ? ' ' : '';
            return `<${tag} style="${style}"${space}${cleanAttrs}>`;
          },
        );
      }
    }
    
    if (styledContent !== finalDocument.content) {
      console.log(`[worker] Applied ${styleMap.size} template styles: ${[...styleMap.keys()].join(', ')}`);
      finalDocument = { ...finalDocument, content: styledContent };
    }
  }

  // ─── Step 7: Validate & Save result ───
  const htmlContent = finalDocument?.content ?? '';
  const contentText = htmlContent
    .replace(/<[^>]*>/g, '')  // Strip HTML tags
    .replace(/\s+/g, ' ')     // Collapse whitespace
    .trim();

  if (!finalDocument || !contentText) {
    const reason = !finalDocument
      ? 'Document generation produced no content'
      : `Document generation produced empty content (raw length: ${htmlContent.length}, text length: ${contentText.length})`;
    console.error(`[worker] ${reason}`);
    await updateRFPDocumentMetadata({
      projectId, opportunityId, documentId,
      updates: { status: 'FAILED', generationError: reason },
      updatedBy: 'system',
    });
    return;
  }

  console.log(`[worker] Final document: title="${finalDocument.title}", content=${htmlContent.length} chars`);

  // ─── Step 7a: Upload HTML to S3 ───
  let htmlContentKey: string;
  try {
    htmlContentKey = await uploadRFPDocumentHtml({
      orgId, projectId, opportunityId, documentId,
      html: htmlContent,
    });
    console.log(`[worker] HTML uploaded to S3: ${htmlContentKey} (${htmlContent.length} chars)`);
  } catch (err) {
    const msg = `Failed to upload HTML to S3: ${(err as Error).message}`;
    console.error(`[worker] ${msg}`);
    await updateRFPDocumentMetadata({
      projectId, opportunityId, documentId,
      updates: { status: 'FAILED', generationError: msg },
      updatedBy: 'system',
    });
    return;
  }

  // ─── Step 7b: Update DynamoDB metadata (status + htmlContentKey, no inline HTML) ───
  const dbContent = {
    title: finalDocument.title,
    customerName: finalDocument.customerName,
    opportunityId: finalDocument.opportunityId,
    outlineSummary: finalDocument.outlineSummary,
  };

  await updateRFPDocumentMetadata({
    projectId, opportunityId, documentId,
    updates: {
      status: 'COMPLETE',
      content: dbContent,
      title: finalDocument.title || 'Generated Document',
      name: finalDocument.title || 'Generated Document',
      htmlContentKey,
    },
    updatedBy: 'system',
  });

  console.log(`[worker] DynamoDB updated: status=COMPLETE, htmlContentKey=${htmlContentKey}`);

  // ─── Step 7c: Create version snapshot ───
  try {
    const existingDoc = await getRFPDocument(projectId, opportunityId, documentId);
    const latestVersionNum = await getLatestVersionNumber(projectId, opportunityId, documentId);
    const newVersionNumber = latestVersionNum + 1;

    const versionHtmlKey = await saveVersionHtml(
      orgId, projectId, opportunityId, documentId,
      newVersionNumber, htmlContent,
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
      title: finalDocument.title ?? existingDoc?.title ?? existingDoc?.name ?? 'Generated Document',
      documentType: existingDoc?.documentType ?? documentType,
      wordCount: htmlContent.split(/\s+/).length,
      changeNote: newVersionNumber === 1 ? 'Initial AI generation' : 'AI regeneration',
      createdBy: existingDoc?.createdBy ?? 'system',
    });

    console.log(`[worker] Created version ${newVersionNumber} for document ${documentId}`);
  } catch (versionErr) {
    // Version creation is non-critical — log but don't fail the generation
    console.error('[worker] Failed to create version snapshot:', (versionErr as Error).message);
  }

  console.log(`[worker] Document generation complete for documentId=${documentId}`);
};
