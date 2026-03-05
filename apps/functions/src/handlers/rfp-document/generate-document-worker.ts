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
  type QaPair,
} from '@/helpers/document-generation';
import { BEDROCK_MODEL_ID, MAX_TOKENS, TEMPERATURE } from '@/constants/document-generation';
import { RFPDocumentContentSchema, RFPDocumentTypeSchema, type RFPDocumentContent } from '@auto-rfp/core';
import { DOCUMENT_TOOLS, executeDocumentTool } from '@/helpers/document-tools';
import { invokeModel } from '@/helpers/bedrock-http-client';
import {
  SECTIONED_DOCUMENT_TYPES,
  DOCUMENT_SECTIONS,
  generateDocumentSectionBySectionHtml,
  buildDocumentTitleHtml,
} from '@/helpers/document-section-generator';

// ─── Helpers ───

/**
 * Normalize the model response: the AI returns `htmlContent` but the schema
 * canonical field is `content`. Merge them so downstream code always uses `content`.
 * Also generates a minimal HTML fallback if neither field has content.
 */
const ensureHtmlContent = (doc: RFPDocumentContent): RFPDocumentContent => {
  const effectiveContent = doc.content || doc.htmlContent || null;

  if (effectiveContent) {
    return { ...doc, content: effectiveContent, htmlContent: undefined };
  }

  console.warn('Model did not return htmlContent — generating minimal HTML fallback');

  const html = [
    `<h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em">${doc.title}</h1>`,
    doc.outlineSummary
      ? `<div style="background:#eff6ff;border-left:4px solid #4f46e5;padding:1em 1.2em;margin:1em 0;border-radius:0 6px 6px 0"><p style="margin:0;line-height:1.7;color:#374151">${doc.outlineSummary}</p></div>`
      : '',
  ].filter(Boolean).join('\n');

  return { ...doc, content: html, htmlContent: undefined };
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

  console.log(`Processing document generation for documentId=${documentId}, type=${documentType}`);

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

  // 3. Gather enrichment context + resolve template HTML in parallel
  const [enrichedKbText, templateHtmlScaffold] = await Promise.all([
    gatherAllContext({ projectId, orgId, opportunityId, solicitation, documentType }),
    resolveTemplateHtml(orgId, documentType, templateId),
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

  if (!userPrompt.trim() || !systemPrompt.trim()) {
    await updateDocumentStatus(
      projectId, opportunityId, documentId, 'FAILED',
      undefined, 'Prompt generation failed',
    );
    return;
  }

  // 4. Choose generation strategy:
  //    - Section-by-section: for large multi-section documents (no template override)
  //    - Single-shot: for short documents or when a template scaffold is provided

  const useSectionedGeneration =
    SECTIONED_DOCUMENT_TYPES.has(documentType) &&
    !templateHtmlScaffold &&
    DOCUMENT_SECTIONS[documentType] !== undefined;

  if (useSectionedGeneration) {
    // ── Section-by-section generation ──────────────────────────────────────
    console.log(`Using section-by-section generation for documentId=${documentId}, type=${documentType}`);

    const sections = DOCUMENT_SECTIONS[documentType]!;
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

    // Derive a proper document title from the type label
    const { TEMPLATE_CATEGORY_LABELS } = await import('@auto-rfp/core');
    const docTitle =
      TEMPLATE_CATEGORY_LABELS[documentType as keyof typeof TEMPLATE_CATEGORY_LABELS] ??
      documentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    // Stitch sections together — replace literal \n escape sequences with real newlines
    const cleanFragments = htmlFragments.map(f =>
      f.replace(/\\n/g, '\n').replace(/\\t/g, '\t'),
    );

    const stitchedHtml = [
      buildDocumentTitleHtml(docTitle),
      ...cleanFragments,
    ].join('\n\n');

    const finalDocument: RFPDocumentContent = {
      title: docTitle,
      content: stitchedHtml,
    };

    await updateDocumentStatus(projectId, opportunityId, documentId, 'COMPLETE', finalDocument, undefined, orgId);
    console.log(`Section-by-section generation complete for documentId=${documentId}: ${sections.length} sections, ${stitchedHtml.length} chars`);
    return;
  }

  // ── Single-shot generation (with tool-use loop) ─────────────────────────
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
    break;
  }

  // 5. Parse model JSON — with fallback for plain-text/HTML responses
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
    modelJson = { title: `Generated ${documentType.replace(/_/g, ' ')}`, htmlContent: rawText };
  }

  // 6. Validate model output against RFPDocumentContent schema
  const { success, data, error } = RFPDocumentContentSchema.safeParse(modelJson);
  if (!success) {
    console.error('Document validation failed', error, { modelJson });
    await updateDocumentStatus(
      projectId, opportunityId, documentId, 'FAILED',
      undefined, 'Model did not return a valid document',
    );
    return;
  }

  // 7. Ensure htmlContent is present
  const finalDocument = ensureHtmlContent(data);

  // 8. Persist generated content — HTML goes to S3, only key stored in DynamoDB
  await updateDocumentStatus(projectId, opportunityId, documentId, 'COMPLETE', finalDocument, undefined, orgId);
  console.log(`Document generation complete for documentId=${documentId}`);
};

// ─── SQS Handler ───

const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      const job = JobSchema.parse(JSON.parse(record.body));
      await processJob(job);
    } catch (err) {
      console.error(
        `Failed to process document generation message ${record.messageId}:`,
        (err as Error)?.message,
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
