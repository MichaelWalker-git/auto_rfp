import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { safeParseJsonFromModel } from '@/helpers/json';
import { gatherAllContext } from '@/helpers/document-context';
import {
  buildSystemPromptForDocumentType,
  buildUserPromptForDocumentType,
} from '@/helpers/document-prompts';
import {
  extractBedrockText,
  loadQaPairs,
  loadSolicitation,
  resolveTemplateHtml,
  updateDocumentStatus,
  buildMacroValues,
  type QaPair,
} from '@/helpers/document-generation';
import { BEDROCK_MODEL_ID, MAX_TOKENS, TEMPERATURE } from '@/constants/document-generation';
import { RFPDocumentContentSchema, RFPDocumentTypeSchema, type RFPDocumentContent } from '@auto-rfp/core';
import { DOCUMENT_TOOLS, executeDocumentTool } from '@/helpers/document-tools';
import { invokeModel } from '@/helpers/bedrock-http-client';
import {
  generateDocumentSectionBySectionHtml,
  buildDocumentTitleHtml,
  extractH1StyleFromTemplate,
} from '@/helpers/document-section-generator';
import {
  parseTemplateSections,
  templateHasStructure,
  injectSectionsIntoTemplate,
  injectContentIntoSimpleTemplate,
} from '@/helpers/template-section-parser';

// ─── Helpers ───

/**
 * Normalize the model response: the AI returns `htmlContent` but the schema
 * canonical field is `content`. Merge them so downstream code always uses `content`.
 * Also generates a minimal HTML fallback if neither field has content.
 */
const ensureHtmlContent = (doc: RFPDocumentContent, templateHtml?: string): RFPDocumentContent => {
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
 * NOTE: We intentionally do NOT embed the document type into the template content —
 * the document type is metadata stored on the document record, not part of the HTML body.
 */
const buildDefaultTemplate = (): string => {
  return `<!-- TEMPLATE SCAFFOLD: This template defines the document wrapper/structure. Replace [CONTENT: ...] with a complete, well-structured HTML document body including appropriate headings and paragraphs. Keep all other text and elements (dates, company name, etc.) in their original positions. -->
<p style="margin:0 0 1em;line-height:1.7">[CONTENT: Write the complete document content here based on the solicitation requirements and provided context. Include appropriate headings, sections, and structure.]</p>`;
};

// ─── Job Schema ───

const JobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentType: RFPDocumentTypeSchema,
  templateId: z.string().optional(),
  documentId: z.string().min(1),
});

type Job = z.infer<typeof JobSchema>;

// ─── Process Job ───

const processJob = async (job: Job): Promise<void> => {
  const { orgId, projectId, opportunityId, documentType, templateId, documentId } = job;

  console.log(`Processing document generation for documentId=${documentId}, type=${documentType}, orgId=${orgId}, projectId=${projectId}, opportunityId=${opportunityId}`);

  try {
    await processJobInner(job);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[FATAL] processJob failed for documentId=${documentId}:`, errorMessage, err);

    // Always mark the document as FAILED so it doesn't stay stuck in GENERATING
    try {
      await updateDocumentStatus(
        projectId, opportunityId, documentId, 'FAILED',
        undefined, `Generation failed: ${errorMessage.substring(0, 500)}`,
      );
      console.log(`Marked documentId=${documentId} as FAILED`);
    } catch (statusErr) {
      console.error(`[FATAL] Failed to mark documentId=${documentId} as FAILED:`, (statusErr as Error)?.message);
    }

    // Re-throw so the SQS handler can report the failure
    throw err;
  }
};

const processJobInner = async (job: Job): Promise<void> => {
  const { orgId, projectId, opportunityId, documentType, templateId, documentId } = job;

  // 1. Load Q&A pairs — required to generate any document
  const qaPairs = await loadQaPairs(projectId);
  if (!qaPairs.length) {
    await updateDocumentStatus(
      projectId, opportunityId, documentId, 'FAILED',
      undefined, 'No questions found for this project',
    );
    return;
  }

  // 2. Load solicitation text
  const solicitation = await loadSolicitation(projectId, opportunityId);

  // 3. Build macro values from real project/org/opportunity data first, then use them for template resolution
  const macroValues = await buildMacroValues({ orgId, projectId, opportunityId });
  console.log(`Built macro values for documentId=${documentId}:`, Object.keys(macroValues));

  // 4. Gather enrichment context + resolve template HTML in parallel (now with macro values)
  const [enrichedKbText, templateHtmlScaffold] = await Promise.all([
    gatherAllContext({ projectId, orgId, opportunityId, solicitation, documentType }),
    resolveTemplateHtml(orgId, documentType, templateId, macroValues),
  ]);

  if (templateHtmlScaffold) {
    console.log(`Using HTML template scaffold for documentId=${documentId} (${templateHtmlScaffold.length} chars)`);
  }

  const systemPrompt = buildSystemPromptForDocumentType(documentType, null, templateHtmlScaffold);
  const userPrompt = buildUserPromptForDocumentType(
    documentType,
    solicitation,
    JSON.stringify(qaPairs),
    enrichedKbText,
  );

  console.log(`Prompt sizes: system=${systemPrompt.length} chars, user=${userPrompt.length} chars, solicitation=${solicitation.length} chars, qaPairs=${qaPairs.length}, enrichedKb=${enrichedKbText.length} chars`);

  if (!userPrompt.trim() || !systemPrompt.trim()) {
    await updateDocumentStatus(
      projectId, opportunityId, documentId, 'FAILED',
      undefined, 'Prompt generation failed',
    );
    return;
  }

  // 5. Choose generation strategy based on template structure:
  //    - Section-by-section: if template has structured sections (h2/h3 headings)
  //    - Single-shot: if template is a simple wrapper or has no sections
  //    - Fail: if no template exists at all

  // Use a default simple template if no template exists for this document type
  const effectiveTemplate = templateHtmlScaffold || buildDefaultTemplate();
  if (!templateHtmlScaffold) {
    console.warn(`No template found for documentId=${documentId}, type=${documentType} — using default {{CONTENT}} template`);
  }

  // Parse template to extract section structure
  const templateSections = parseTemplateSections(effectiveTemplate);
  const useSectionedGeneration = templateSections !== null && templateSections.length > 1;

  console.log(`[DEBUG] Template parsing result: ${templateSections ? `${templateSections.length} sections found` : 'no sections (simple template)'}`);
  if (templateSections) {
    console.log(`[DEBUG] Parsed sections:`, JSON.stringify(templateSections.map(s => ({ title: s.title, description: s.description })), null, 2));
  }
  console.log(`[DEBUG] Generation strategy decision: ${useSectionedGeneration ? 'SECTION-BY-SECTION' : 'SINGLE-SHOT'} (sections=${templateSections?.length || 0}, requirement: >1 section)`);

  if (useSectionedGeneration) {
    // ── Section-by-section generation ──────────────────────────────────────
    console.log(`Using section-by-section generation for documentId=${documentId}: ${templateSections.length} sections from template`);

    const sections = templateSections!;
    const htmlFragments = await generateDocumentSectionBySectionHtml({
      modelId: BEDROCK_MODEL_ID,
      systemPrompt,
      initialUserPrompt: userPrompt,
      sections,
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
      await updateDocumentStatus(
        projectId, opportunityId, documentId, 'FAILED',
        undefined, 'Section-by-section generation produced no content',
      );
      return;
    }

    // Extract document title from template's <h1> or use document type as fallback
    const titleMatch = effectiveTemplate.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const rawTitle = titleMatch ? titleMatch[1] : null;
    const docTitle = rawTitle
      ? rawTitle
          .replace(/<[^>]+>/g, '') // Remove HTML tags
          .replace(/\{\{[A-Z0-9_]+\}\}/g, '') // Remove unresolved macros
          .replace(/\[[^\]]+\]/g, '') // Remove [placeholder] text
          .trim()
      : documentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    // Clean escape sequences from generated fragments
    const cleanFragments = htmlFragments.map(f =>
      f.replace(/\\n/g, '\n').replace(/\\t/g, '\t'),
    );

    // Inject generated sections back into the template structure.
    // This preserves the template's preamble (header, logo, title, intro text,
    // images, resolved macros) and postamble (footer, closing) while replacing
    // only the section content with AI-generated text.
    const rawStitchedHtml = injectSectionsIntoTemplate(effectiveTemplate, cleanFragments);

    // Strip any remaining [CONTENT: ...] placeholders that the AI failed to fill in
    const stitchedHtml = rawStitchedHtml.replace(/\[CONTENT:\s*[^\]]*\]/gi, '');

    const finalDocument: RFPDocumentContent = {
      title: docTitle,
      content: stitchedHtml,
    };

    console.log(`[DEBUG] Section-by-section final document structure:`, {
      title: docTitle,
      sectionsGenerated: htmlFragments.length,
      totalContentLength: stitchedHtml.length,
      templatePreserved: true,
    });
    console.log(`[DEBUG] Section-by-section stitched content (first 1000 chars):`, stitchedHtml.substring(0, 1000));
    console.log(`[DEBUG] Section-by-section stitched content (last 500 chars):`, stitchedHtml.substring(Math.max(0, stitchedHtml.length - 500)));

    await updateDocumentStatus(projectId, opportunityId, documentId, 'COMPLETE', finalDocument, undefined, orgId);
    console.log(`Section-by-section generation complete for documentId=${documentId}: ${sections.length} sections from template, ${stitchedHtml.length} chars total (template structure preserved)`);
    return;
  }

  // ── Single-shot generation (with tool-use loop) ─────────────────────────
  console.log(`Using single-shot generation for documentId=${documentId} with template scaffold (${effectiveTemplate.length} chars)`);
  const TABLE_HEAVY_TYPES = new Set(['COMPLIANCE_MATRIX', 'APPENDICES', 'PAST_PERFORMANCE', 'CERTIFICATIONS']);
  const baseMaxTokens = TABLE_HEAVY_TYPES.has(documentType) ? Math.max(MAX_TOKENS, 16000) : MAX_TOKENS;
  const effectiveMaxTokens = enrichedKbText.length > 1000 ? Math.max(baseMaxTokens, 8000) : baseMaxTokens;
  const MAX_TOOL_ROUNDS = 3;

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
      console.log(`Tool use round ${toolRounds + 1}: ${toolUseBlocks.length} tool call(s)`);

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
          })
        )
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

    if (!rawText && stopReason === 'tool_use' && isLastRound) {
      console.warn('Last round still returned tool_use — sending final generation request without tools');
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

    console.log(`Document generation complete after ${toolRounds} tool round(s), ${rawText.length} chars`);
    console.log(`[DEBUG] Raw AI response (first 1000 chars):`, rawText.substring(0, 1000));
    console.log(`[DEBUG] Raw AI response (last 500 chars):`, rawText.substring(Math.max(0, rawText.length - 500)));
    break;
  }

  // 6. Parse model JSON — with fallback for plain-text/HTML responses
  let modelJson: unknown;
  try {
    modelJson = safeParseJsonFromModel(rawText);

    // Check if the model returned a JSON structure as text instead of as structured data
    // This happens when the model outputs something like: { "title": "...", "content": "..." } as a string
    if (typeof modelJson === 'object' && modelJson !== null) {
      const obj = modelJson as Record<string, unknown>;
      // If htmlContent or content contains what looks like a JSON object, try to parse it
      const htmlField = obj.htmlContent || obj.content;
      if (typeof htmlField === 'string' && htmlField.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(htmlField);
          if (parsed && typeof parsed === 'object' && (parsed.content || parsed.htmlContent)) {
            console.warn('Detected JSON-as-text in content field, extracting actual HTML');
            modelJson = parsed;
          }
        } catch {
          // Not valid JSON, continue with the original
        }
      }
    }
  } catch (parseErr) {
    console.warn(`safeParseJsonFromModel failed for documentId=${documentId}: ${(parseErr as Error).message}. Wrapping raw text as HTML.`);
    modelJson = { title: 'Generated Document', htmlContent: rawText };
  }

  // 7. Validate model output against RFPDocumentContent schema
  const { success, data, error } = RFPDocumentContentSchema.safeParse(modelJson);
  if (!success) {
    console.error('Document validation failed', error, { modelJson });
    await updateDocumentStatus(
      projectId, opportunityId, documentId, 'FAILED',
      undefined, 'Model did not return a valid document',
    );
    return;
  }

  // 8. Ensure htmlContent is present
  const normalizedDocument = ensureHtmlContent(data, effectiveTemplate);

  // 9. For simple templates (with {{CONTENT}} placeholder), inject the generated
  //    content into the template. For structured templates, the AI returns the full HTML.
  //
  //    Then strip any remaining [CONTENT: ...] placeholders that weren't filled in,
  //    and any HTML/scaffold comments from the template preprocessing.
  let finalHtml = normalizedDocument.content ?? '';

  // Check if this is a simple template with a [CONTENT: ...] placeholder
  // If so, inject the generated content into the template structure
  if (/\[CONTENT:\s*[^\]]*\]/i.test(effectiveTemplate)) {
    console.log('[DEBUG] Detected simple template with [CONTENT: ...] placeholder, injecting generated content');
    const injected = injectContentIntoSimpleTemplate(effectiveTemplate, finalHtml);
    if (injected) {
      finalHtml = injected;
      console.log(`[DEBUG] Successfully injected content into template (${finalHtml.length} chars)`);
    } else {
      console.warn('[DEBUG] injectContentIntoSimpleTemplate returned null, using AI output as-is');
    }
  }

  // Strip any remaining [CONTENT: ...] placeholders the AI didn't fill in
  finalHtml = finalHtml.replace(/\[CONTENT:\s*[^\]]*\]/gi, '');

  // Strip template scaffold comments that the AI may have copied verbatim
  finalHtml = finalHtml.replace(/<!--\s*TEMPLATE SCAFFOLD:.*?-->\s*/gi, '');
  finalHtml = finalHtml.replace(/<!--\s*PRESERVE THIS IMAGE TAG EXACTLY AS-IS\s*-->\s*/gi, '');
  finalHtml = finalHtml.replace(/<!--\s*Section guidance:.*?-->\s*/gi, '');

  const finalDocument: RFPDocumentContent = {
    ...normalizedDocument,
    content: finalHtml,
  };

  console.log(`[DEBUG] Final document structure:`, {
    title: finalDocument.title,
    contentLength: finalDocument.content?.length || 0,
    hasContent: !!finalDocument.content,
    templatePreserved: !!effectiveTemplate,
  });
  console.log(`[DEBUG] Final document content (first 1000 chars):`, finalDocument.content?.substring(0, 1000));
  console.log(`[DEBUG] Final document content (last 500 chars):`, finalDocument.content?.substring(Math.max(0, (finalDocument.content?.length || 0) - 500)));

  // 10. Persist generated content — HTML goes to S3, only key stored in DynamoDB
  await updateDocumentStatus(projectId, opportunityId, documentId, 'COMPLETE', finalDocument, undefined, orgId);
  console.log(`Document generation complete for documentId=${documentId} (template structure preserved)`);
};

// ─── SQS Handler ───

const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    let job: Job | null = null;
    try {
      job = JobSchema.parse(JSON.parse(record.body));
      await processJob(job);
    } catch (err) {
      const errorMessage = (err as Error)?.message ?? 'Unknown error';
      console.error(
        `Failed to process document generation message ${record.messageId}:`,
        errorMessage,
      );

      // Mark the document as FAILED so it doesn't stay stuck in GENERATING forever
      if (job) {
        try {
          await updateDocumentStatus(
            job.projectId, job.opportunityId, job.documentId, 'FAILED',
            undefined, `Generation failed: ${errorMessage.substring(0, 500)}`,
          );
        } catch (statusErr) {
          console.error('Failed to update document status to FAILED:', (statusErr as Error)?.message);
        }
      }

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
