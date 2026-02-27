import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { safeParseJsonFromModel } from '@/helpers/json';
import { invokeModel } from '@/helpers/bedrock-http-client';
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
import type { OrgContactInfo, UserContactInfo } from '@/helpers/document-generation-queue';

// ─── Helpers ───

/**
 * Normalize the model response: the AI returns `htmlContent` but the schema
 * canonical field is `content`. Merge them so downstream code always uses `content`.
 * Also generates a minimal HTML fallback if neither field has content.
 */
const ensureHtmlContent = (doc: RFPDocumentContent): RFPDocumentContent => {
  // Normalize: if model returned htmlContent but not content, promote it
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

const OrgContactSchema = z.object({
  orgName: z.string().optional(),
  orgAddress: z.string().optional(),
  orgPhone: z.string().optional(),
  orgEmail: z.string().optional(),
  orgWebsite: z.string().optional(),
}).optional();

const UserContactSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  title: z.string().optional(),
  phone: z.string().optional(),
}).optional();

const JobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentType: RFPDocumentTypeSchema,
  templateId: z.string().optional(),
  documentId: z.string().min(1),
  orgContact: OrgContactSchema,
  userContact: UserContactSchema,
});

type Job = z.infer<typeof JobSchema>;

// ─── Format org/user contact context ─────────────────────────────────────────

const formatContactContext = (
  orgContact?: OrgContactInfo | null,
  userContact?: UserContactInfo | null,
): string => {
  const parts: string[] = [];

  if (orgContact?.orgName || orgContact?.orgAddress || orgContact?.orgPhone || orgContact?.orgEmail || orgContact?.orgWebsite) {
    parts.push('=== SUBMITTING ORGANIZATION ===');
    if (orgContact.orgName) parts.push(`Company Name: ${orgContact.orgName}`);
    if (orgContact.orgAddress) parts.push(`Address: ${orgContact.orgAddress}`);
    if (orgContact.orgPhone) parts.push(`Phone: ${orgContact.orgPhone}`);
    if (orgContact.orgEmail) parts.push(`Email: ${orgContact.orgEmail}`);
    if (orgContact.orgWebsite) parts.push(`Website: ${orgContact.orgWebsite}`);
  }

  if (userContact?.name || userContact?.email || userContact?.title || userContact?.phone) {
    parts.push('\n=== POINT OF CONTACT (PROPOSAL SIGNATORY) ===');
    if (userContact.name) parts.push(`Name: ${userContact.name}`);
    if (userContact.title) parts.push(`Title: ${userContact.title}`);
    if (userContact.email) parts.push(`Email: ${userContact.email}`);
    if (userContact.phone) parts.push(`Phone: ${userContact.phone}`);
  }

  return parts.join('\n');
};

// ─── Process Job ───

async function processJob(job: Job): Promise<void> {
  const { orgId, projectId, opportunityId, documentType, templateId, documentId, orgContact, userContact } = job;
  const effectiveOpportunityId = opportunityId || 'default';

  console.log(`Processing document generation for documentId=${documentId}, type=${documentType}`);

  // 1. Load Q&A pairs — required to generate any document
  const qaPairs = await loadQaPairs(projectId);
  if (!qaPairs.length) {
    await updateDocumentStatus(
      projectId, effectiveOpportunityId, documentId, 'FAILED',
      undefined, 'No questions found for this project',
    );
    return;
  }

  // 2. Load solicitation text
  const solicitation = await loadSolicitation(projectId, opportunityId);

  // 3. Gather enrichment context + resolve template HTML in parallel
  // Pass documentType so context budgets are allocated toward the most relevant sources
  const [enrichedKbText, templateHtmlScaffold] = await Promise.all([
    gatherAllContext({ projectId, orgId, opportunityId, solicitation, documentType }),
    resolveTemplateHtml(orgId, documentType, templateId),
  ]);

  if (templateHtmlScaffold) {
    console.log(`Using HTML template scaffold for documentId=${documentId} (${templateHtmlScaffold.length} chars)`);
  }

  // Build contact context section and prepend to enriched KB text
  const contactContext = formatContactContext(orgContact, userContact);
  const enrichedWithContact = contactContext
    ? `--- COMPANY & CONTACT INFORMATION ---\n(Use this EXACT information for all contact details, signatures, and company references in the document. Do NOT use placeholder names or fake contact info.)\n${contactContext}\n\n${enrichedKbText}`
    : enrichedKbText;

  const systemPrompt = buildSystemPromptForDocumentType(documentType, null, templateHtmlScaffold);
  const userPrompt = buildUserPromptForDocumentType(
    documentType,
    solicitation,
    JSON.stringify(qaPairs),
    enrichedWithContact,
  );

  if (!userPrompt.trim() || !systemPrompt.trim()) {
    await updateDocumentStatus(
      projectId, effectiveOpportunityId, documentId, 'FAILED',
      undefined, 'Prompt generation failed',
    );
    return;
  }

  // 5. Call Bedrock with tool use loop (max 3 tool rounds, then force final generation)
  // Table-heavy document types (compliance matrix, appendices) need more tokens
  const TABLE_HEAVY_TYPES = new Set(['COMPLIANCE_MATRIX', 'APPENDICES', 'PAST_PERFORMANCE', 'CERTIFICATIONS']);
  const baseMaxTokens = TABLE_HEAVY_TYPES.has(documentType) ? Math.max(MAX_TOKENS, 16000) : MAX_TOKENS;
  const effectiveMaxTokens = enrichedKbText.length > 1000 ? Math.max(baseMaxTokens, 8000) : baseMaxTokens;
  const MAX_TOOL_ROUNDS = 3;

  // Conversation messages — starts with the user prompt, grows as tools are called
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

    // Offer tools only in non-final rounds; on the last round force text output
    if (!isLastRound) {
      requestBody.tools = DOCUMENT_TOOLS;
    }

    const responseBody = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(requestBody));
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody));

    const stopReason: string = parsed.stop_reason ?? 'end_turn';
    const content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }> =
      parsed.content ?? [];

    // If Claude wants to use tools and we still have rounds left, execute them
    if (stopReason === 'tool_use' && !isLastRound) {
      const toolUseBlocks = content.filter(c => c.type === 'tool_use');
      console.log(`Tool use round ${toolRounds + 1}: ${toolUseBlocks.length} tool call(s)`);

      // Add assistant response to conversation
      messages.push({ role: 'assistant', content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(block =>
          executeDocumentTool({
            toolName: block.name ?? '',
            toolInput: (block.input ?? {}) as Record<string, unknown>,
            toolUseId: block.id ?? '',
            orgId,
            projectId,
            qaPairs,
          })
        )
      );

      // Add tool results as user message
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

    // Extract final text response (may include both text and tool_use blocks — take text only)
    rawText = content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n')
      .trim();

    if (!rawText) {
      // Fallback: try legacy extractBedrockText
      rawText = extractBedrockText(parsed);
    }

    // If still no text (e.g. Claude only returned tool_use on last round), add a final prompt
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

  // 6. Parse model JSON — with fallback for plain-text/HTML responses
  let modelJson: unknown;
  try {
    modelJson = safeParseJsonFromModel(rawText);
  } catch (parseErr) {
    // Model returned plain text or HTML without a JSON wrapper.
    // Wrap it so we can still produce a usable document.
    console.warn(`safeParseJsonFromModel failed for documentId=${documentId}: ${(parseErr as Error).message}. Wrapping raw text as HTML.`);
    modelJson = { title: `Generated ${documentType.replace(/_/g, ' ')}`, htmlContent: rawText };
  }

  // 7. Validate model output against RFPDocumentContent schema
  const { success, data, error } = RFPDocumentContentSchema.safeParse(modelJson);
  if (!success) {
    console.error('Document validation failed', error, { modelJson });
    await updateDocumentStatus(
      projectId, effectiveOpportunityId, documentId, 'FAILED',
      undefined, 'Model did not return a valid document',
    );
    return;
  }

  // 7. Ensure htmlContent is present — convert legacy sections to HTML if needed
  const finalDocument = ensureHtmlContent(data);

  // 8. Persist generated content — HTML goes to S3, only key stored in DynamoDB
  await updateDocumentStatus(projectId, effectiveOpportunityId, documentId, 'COMPLETE', finalDocument, undefined, orgId);
  console.log(`Document generation complete for documentId=${documentId}`);
}

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
