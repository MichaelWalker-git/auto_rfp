import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { z } from 'zod';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/question';
import { RFP_DOCUMENT_PK } from '../constants/rfp-document';
import { safeParseJsonFromModel } from '../helpers/json';
import { useProposalUserPrompt } from '../constants/prompt';
import { invokeModel } from '../helpers/bedrock-http-client';
import { loadAllSolicitationTexts } from '../helpers/executive-opportunity-brief';
import { getTemplate, listTemplatesByOrg } from '../helpers/template';
import { gatherAllContext } from '../helpers/document-context';
import { buildSystemPromptForDocumentType } from '../helpers/document-prompts';
import { ProposalDocumentSchema } from '@auto-rfp/shared';

// ─── Config ───

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_TOKENS = Number(requireEnv('BEDROCK_MAX_TOKENS', '4000'));
const TEMPERATURE = Number(requireEnv('BEDROCK_TEMPERATURE', '0.1'));
const MAX_SOLICITATION_CHARS = Number(requireEnv('PROPOSAL_MAX_SOLICITATION_CHARS', '80000'));

// ─── Job Schema ───

const JobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentType: z.string().min(1),
  templateId: z.string().optional(),
  documentId: z.string().min(1),
});

type Job = z.infer<typeof JobSchema>;

// ─── Helpers ───

const extractBedrockText = (outer: any): string =>
  outer?.content?.[0]?.text?.trim() ||
  outer?.output_text?.trim() ||
  outer?.completion?.trim() ||
  '';

async function loadQaPairs(projectId: string) {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': QUESTION_PK, ':skPrefix': `${projectId}#` },
    }),
  );
  return (Items ?? []).map((item: any) => ({
    question: item.question ?? '',
    answer: item.answer ?? '',
  }));
}

async function loadSolicitation(projectId: string, opportunityId: string): Promise<string> {
  try {
    return await loadAllSolicitationTexts(projectId, opportunityId, MAX_SOLICITATION_CHARS);
  } catch (err) {
    console.warn('Failed to load solicitation texts:', (err as Error)?.message);
    return '';
  }
}

async function resolveTemplate(orgId: string, documentType: string, templateId?: string) {
  if (templateId) {
    const t = await getTemplate(orgId, templateId);
    return t?.sections ?? null;
  }
  try {
    const { items } = await listTemplatesByOrg(orgId, { category: documentType, status: 'PUBLISHED', limit: 1 });
    return items?.[0]?.sections ?? null;
  } catch {
    return null;
  }
}

async function updateDocumentStatus(
  projectId: string,
  opportunityId: string,
  documentId: string,
  status: 'COMPLETE' | 'FAILED',
  content?: any,
  error?: string,
): Promise<void> {
  const sk = `${projectId}#${opportunityId}#${documentId}`;
  const now = new Date().toISOString();

  const updateParts: string[] = ['#status = :status', '#updatedAt = :now'];
  const names: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, any> = {
    ':status': status,
    ':now': now,
  };

  if (content) {
    updateParts.push('#content = :content');
    updateParts.push('#title = :title');
    updateParts.push('#name = :name');
    names['#content'] = 'content';
    names['#title'] = 'title';
    names['#name'] = 'name';
    values[':content'] = content;
    values[':title'] = content.proposalTitle || 'Generated Document';
    values[':name'] = content.proposalTitle || 'Generated Document';
  }

  if (error) {
    updateParts.push('#error = :error');
    names['#error'] = 'generationError';
    values[':error'] = error;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

// ─── Process Job ───

async function processJob(job: Job): Promise<void> {
  const { orgId, projectId, opportunityId, documentType, templateId, documentId } = job;
  const effectiveOpportunityId = opportunityId || 'default';

  console.log(`Processing document generation for documentId ${documentId}, type ${documentType}`);

  try {
    // 1. Load Q&A pairs
    const qaPairs = await loadQaPairs(projectId);
    if (!qaPairs.length) {
      await updateDocumentStatus(projectId, effectiveOpportunityId, documentId, 'FAILED', undefined, 'No questions found for this project');
      return;
    }

    // 2. Load solicitation text
    const solicitation = await loadSolicitation(projectId, opportunityId);

    // 3. Gather enrichment context + resolve template
    const [enrichedKbText, templateSections] = await Promise.all([
      gatherAllContext({ projectId, orgId, opportunityId, solicitation }),
      resolveTemplate(orgId, documentType, templateId),
    ]);

    // 4. Build prompts
    const systemPrompt = buildSystemPromptForDocumentType(documentType, templateSections);
    const userPrompt = await useProposalUserPrompt(orgId, solicitation, JSON.stringify(qaPairs), enrichedKbText);

    if (!userPrompt?.trim() || !systemPrompt?.trim()) {
      await updateDocumentStatus(projectId, effectiveOpportunityId, documentId, 'FAILED', undefined, 'Prompt generation failed');
      return;
    }

    // 5. Call Bedrock
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

    const textChunk = extractBedrockText(JSON.parse(new TextDecoder('utf-8').decode(responseBody)));
    const modelJson = safeParseJsonFromModel(textChunk);

    // 6. Validate output
    const result = ProposalDocumentSchema.safeParse(modelJson);
    if (!result.success) {
      console.error('Document validation failed', result.error, { modelJson });
      await updateDocumentStatus(projectId, effectiveOpportunityId, documentId, 'FAILED', undefined, 'Model did not return a valid document');
      return;
    }

    // 7. Update DB with generated content
    await updateDocumentStatus(projectId, effectiveOpportunityId, documentId, 'COMPLETE', result.data);

    console.log(`Document generation complete for documentId ${documentId}`);
  } catch (err) {
    console.error(`Document generation failed for documentId ${documentId}:`, (err as Error)?.message);
    await updateDocumentStatus(
      projectId,
      effectiveOpportunityId,
      documentId,
      'FAILED',
      undefined,
      err instanceof Error ? err.message : 'Unknown error',
    );
    throw err; // Re-throw so SQS retries
  }
}

// ─── SQS Handler ───

const baseHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      const rawBody = JSON.parse(record.body);
      const job = JobSchema.parse(rawBody);
      await processJob(job);
    } catch (err) {
      console.error(`Failed to process document generation message ${record.messageId}:`, (err as Error)?.message);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

export const handler = withSentryLambda(baseHandler);
