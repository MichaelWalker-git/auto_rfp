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
  updateDocumentStatus,
  type QaPair,
} from '@/helpers/document-generation';
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
 * Clean generated HTML: strip remaining placeholders, scaffold comments, and escape sequences.
 */
export const cleanGeneratedHtml = (html: string): string =>
  html
    // Strip remaining [CONTENT: ...] placeholders the AI didn't fill in
    .replace(/\[CONTENT:\s*[^\]]*\]/gi, '')
    // Closed scaffold comments (properly terminated with -->)
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[\s\S]*?-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS IMAGE TAG EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*Section guidance:[\s\S]*?-->\s*/gi, '')
    // Unclosed comments: strip from <!-- marker to the next block-level tag
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[^<]*(?:<(?![hH][1-6]|[pP][ >]|[dD][iI][vV]|[uU][lL]|[oO][lL]|[tT][aA][bB])[^<]*)*/g, '')
    .replace(/<!--\s*Section guidance:[^<]*(?:<(?![hH][1-6]|[pP][ >]|[dD][iI][vV]|[uU][lL]|[oO][lL]|[tT][aA][bB])[^<]*)*/g, '')
    // Clean escape sequences
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    // Strip leading/trailing non-HTML artifacts (commas, whitespace, JSON remnants)
    .replace(/^[\s,;]+/, '')
    .replace(/[\s,;]+$/, '');

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
  if (!templateSections || templateSections.length <= 1) {
    console.log(`[template-gen] Template has ${templateSections?.length ?? 0} sections — not enough for section-by-section generation`);
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

  // For simple templates (with {{CONTENT}} placeholder), inject the generated
  // content into the template structure
  let finalHtml = normalizedDocument.content ?? '';

  if (/\[CONTENT:\s*[^\]]*\]/i.test(templateHtml)) {
    console.log('[single-shot] Detected simple template with [CONTENT: ...] placeholder, injecting generated content');
    const injected = injectContentIntoSimpleTemplate(templateHtml, finalHtml);
    if (injected) {
      finalHtml = injected;
      console.log(`[single-shot] Successfully injected content into template (${finalHtml.length} chars)`);
    } else {
      console.warn('[single-shot] injectContentIntoSimpleTemplate returned null, using AI output as-is');
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
    await updateDocumentStatus(
      projectId, opportunityId, documentId, 'FAILED',
      undefined, 'Prompt generation failed',
    );
    return;
  }

  // ─── Step 6: Choose generation strategy ───
  const effectiveTemplate = templateHtmlScaffold || buildDefaultTemplate();
  if (!templateHtmlScaffold) {
    console.warn(`No template found for documentId=${documentId}, type=${documentType} — using default template`);
  }

  let finalDocument: RFPDocumentContent | null = null;

  // Strategy 1: Try section-by-section generation (template with <h2> sections)
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

  // Strategy 2: Fall back to single-shot generation
  if (!finalDocument) {
    console.log(`[worker] Falling back to single-shot generation for documentId=${documentId}`);
    finalDocument = await generateSingleShot({
      templateHtml: effectiveTemplate,
      systemPrompt,
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

  // ─── Step 7: Save result ───
  if (!finalDocument || !finalDocument.content?.trim()) {
    await updateDocumentStatus(
      projectId, opportunityId, documentId, 'FAILED',
      undefined, finalDocument
        ? 'Document generation produced empty content'
        : 'Document generation produced no content',
    );
    return;
  }

  console.log(`[worker] Final document: title="${finalDocument.title}", content=${finalDocument.content?.length ?? 0} chars`);

  await updateDocumentStatus(projectId, opportunityId, documentId, 'COMPLETE', finalDocument, undefined, orgId);
  console.log(`Document generation complete for documentId=${documentId}`);
};
