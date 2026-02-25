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
  buildTemplateHtmlScaffold,
  extractBedrockText,
  loadQaPairs,
  loadSolicitation,
  resolveTemplateSections,
  updateDocumentStatus,
} from '@/helpers/document-generation';
import type { TemplateSection } from '@auto-rfp/core';
import { BEDROCK_MODEL_ID, MAX_TOKENS, TEMPERATURE } from '@/constants/document-generation';
import { RFPDocumentContentSchema, RFPDocumentTypeSchema, type RFPDocumentContent } from '@auto-rfp/core';

// ─── Helpers ───

/**
 * Ensures the document has htmlContent.
 * If the model did not return htmlContent, generates a minimal HTML fallback
 * from the metadata fields.
 */
const ensureHtmlContent = (doc: RFPDocumentContent): RFPDocumentContent => {
  if (doc.content) return doc;

  console.warn('Model did not return htmlContent — generating minimal HTML fallback');

  const html = [
    `<h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em">${doc.title}</h1>`,
    doc.outlineSummary
      ? `<div style="background:#eff6ff;border-left:4px solid #4f46e5;padding:1em 1.2em;margin:1em 0;border-radius:0 6px 6px 0"><p style="margin:0;line-height:1.7;color:#374151">${doc.outlineSummary}</p></div>`
      : '',
  ].filter(Boolean).join('\n');

  return { ...doc, content: html };
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

async function processJob(job: Job): Promise<void> {
  const { orgId, projectId, opportunityId, documentType, templateId, documentId } = job;
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

  // 3. Gather enrichment context + resolve template in parallel
  // Pass documentType so context budgets are allocated toward the most relevant sources
  const [enrichedKbText, templateSections] = await Promise.all([
    gatherAllContext({ projectId, orgId, opportunityId, solicitation, documentType }),
    resolveTemplateSections(orgId, documentType, templateId),
  ]);

  // 4. Build HTML scaffold from template sections (if available) and pass to prompt builder
  const templateHtmlScaffold = templateSections?.length
    ? buildTemplateHtmlScaffold(templateSections as TemplateSection[])
    : null;

  if (templateHtmlScaffold) {
    console.log(`Using HTML template scaffold (${templateSections!.length} sections) for documentId=${documentId}`);
  }

  const systemPrompt = buildSystemPromptForDocumentType(documentType, templateSections, templateHtmlScaffold);
  const userPrompt = buildUserPromptForDocumentType(
    documentType,
    solicitation,
    JSON.stringify(qaPairs),
    enrichedKbText,
  );

  if (!userPrompt.trim() || !systemPrompt.trim()) {
    await updateDocumentStatus(
      projectId, effectiveOpportunityId, documentId, 'FAILED',
      undefined, 'Prompt generation failed',
    );
    return;
  }

  // 5. Call Bedrock — scale max tokens based on context size
  const effectiveMaxTokens = enrichedKbText.length > 1000 ? Math.max(MAX_TOKENS, 8000) : MAX_TOKENS;

  const responseBody = await invokeModel(
    BEDROCK_MODEL_ID,
    JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: systemPrompt }],
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      max_tokens: effectiveMaxTokens,
      temperature: TEMPERATURE,
    }),
  );

  const rawText = extractBedrockText(JSON.parse(new TextDecoder('utf-8').decode(responseBody)));
  const modelJson = safeParseJsonFromModel(rawText);

  // 6. Validate model output against RFPDocumentContent schema
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
