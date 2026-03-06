import { requireEnv } from '@/helpers/env';
import { loadTextFromS3 } from '@/helpers/s3';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { updateOpportunity, getOpportunity } from '@/helpers/opportunity';
import { getQuestionFileItem, updateQuestionFile, checkQuestionFileCancelled } from '@/helpers/questionFile';
import { withSentryLambda } from '@/sentry-lambda';

// Resolved lazily so tests can set process.env before module-level code runs
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');
const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

type FulfillOpportunityFieldsEvent = {
  opportunityId: string;
  textFileKey: string;
  projectId?: string;
  questionFileId?: string;
};

type FulfillOpportunityFieldsResult = {
  ok: boolean;
  opportunityId: string;
  updatedFieldCount: number;
  confidence?: number;
  cancelled?: boolean;
  skipped?: boolean;
  reason?: string;
};

export const buildBedrockMessagesBody = (docText: string) => {
  const userText =
    'From the document text below, fill opportunity fields. ' +
    'If a field is not present, omit it (do not invent). ' +
    'Use ISO date-time where applicable.\n\n' +
    'Return JSON in this shape:\n' +
    '{\n' +
    '  "fields": {\n' +
    '    "title"?: string,\n' +
    '    "solicitationNumber"?: string,\n' +
    '    "agency"?: string,\n' +
    '    "subAgency"?: string,\n' +
    '    "postedDateIso"?: string,\n' +
    '    "dueDateIso"?: string,\n' +
    '    "setAside"?: string,\n' +
    '    "naics"?: string,\n' +
    '    "psc"?: string,\n' +
    '    "placeOfPerformance"?: string,\n' +
    '    "contractType"?: string,\n' +
    '    "summary"?: string,\n' +
    '    "contacts"?: Array<{ name?: string, email?: string, phone?: string, role?: string }>,\n' +
    '    "urls"?: string[]\n' +
    '  },\n' +
    '  "confidence": number,\n' +
    '  "notes"?: string\n' +
    '}\n\n' +
    'DOCUMENT TEXT:\n' +
    docText.slice(0, 180_000);

  return {
    anthropic_version: 'bedrock-2023-05-31',
    system:
      'You extract and normalize government procurement opportunity metadata from raw solicitation text. ' +
      'Return ONLY valid JSON (no markdown, no commentary).',
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
    max_tokens: 1500,
  };
};

export const baseHandler = async (
  event: FulfillOpportunityFieldsEvent,
): Promise<FulfillOpportunityFieldsResult> => {
  const { opportunityId, projectId, questionFileId, textFileKey } = event;

  // Cancellation check runs first — before validation
  if (projectId && opportunityId && questionFileId) {
    const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);
    if (isCancelled) {
      console.log(`Pipeline cancelled for ${questionFileId}, skipping processing`);
      return { ok: true, opportunityId, cancelled: true, updatedFieldCount: 0 };
    }
  }

  if (!projectId || !questionFileId || !textFileKey || !opportunityId) {
    throw new Error('projectId, questionFileId, textFileKey and opportunityId are all required');
  }

  const qf = await getQuestionFileItem(projectId, opportunityId, questionFileId);
  const orgId = qf?.orgId;

  if (!orgId) {
    throw new Error('Question file not found or missing orgId');
  }

  try {
    // Skip field fulfillment for SAM_GOV — fields already populated from source
    const opportunity = await getOpportunity({ orgId, projectId, oppId: opportunityId });

    if (opportunity?.item.source === 'SAM_GOV') {
      console.log(`Skipping opportunity field fulfillment for SAM_GOV opportunity: ${opportunityId}`);
      // Don't mark as PROCESSED here - extract-questions will do that after it completes
      return {
        ok: true,
        opportunityId,
        updatedFieldCount: 0,
        confidence: 100,
        skipped: true,
        reason: 'SAM_GOV opportunity — fields already populated from source',
      };
    }

    const docText = await loadTextFromS3(getDocumentsBucket(), textFileKey);
    if (!docText || docText.length === 0) {
      throw new Error(`Empty document text from S3: ${textFileKey}`);
    }

    const responseBody = await invokeModel(getBedrockModelId(), JSON.stringify(buildBedrockMessagesBody(docText)));
    const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;

    const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? null;

    const modelOut = rawText ? (safeParseJsonFromModel(String(rawText)) as Record<string, unknown>) : null;

    const fields =
      modelOut?.fields && typeof modelOut.fields === 'object'
        ? (modelOut.fields as Record<string, unknown>)
        : null;

    const confidence =
      typeof modelOut?.confidence === 'number' && Number.isFinite(modelOut.confidence)
        ? (modelOut.confidence as number)
        : undefined;

    if (!fields) {
      throw new Error('Bedrock did not return { fields: {...} }');
    }

    await updateOpportunity({ orgId, projectId, oppId: opportunityId, patch: fields });
    // Don't mark as PROCESSED here - extract-questions will do that after it completes
    // This prevents a race condition where the file is marked PROCESSED before questions are extracted

    return {
      ok: true,
      opportunityId,
      updatedFieldCount: Object.keys(fields).length,
      confidence,
      cancelled: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('fulfill-opportunity-fields error:', message);

    await updateQuestionFile(projectId, opportunityId, questionFileId, {
      status: 'FAILED',
      errorMessage: message,
    });

    return { ok: false, opportunityId, updatedFieldCount: 0, cancelled: false };
  }
};

export const handler = withSentryLambda(baseHandler);
