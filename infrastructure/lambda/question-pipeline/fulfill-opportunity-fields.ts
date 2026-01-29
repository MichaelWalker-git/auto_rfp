import { requireEnv } from '../helpers/env';
import { loadTextFromS3 } from '../helpers/s3';
import { invokeModel } from '../helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '../helpers/json';
import { updateOpportunity, getOpportunity } from '../helpers/opportunity';
import { getQuestionFileItem, updateQuestionFile, checkQuestionFileCancelled } from '../helpers/questionFile';
import { withSentryLambda } from '../sentry-lambda';

type Event = {
  opportunityId: string;
  textFileKey: string;
  projectId?: string;
  questionFileId?: string;
};

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

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
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: userText }],
      },
    ],
    temperature: 0,
    max_tokens: 1500,
  };
};

export const baseHandler = async (event: Event) => {
  const { opportunityId, projectId, questionFileId, textFileKey } = event;
  console.log(`Event: ${JSON.stringify(event, null, 2)}`);

  if (projectId && opportunityId && questionFileId) {
    const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);
    if (isCancelled) {
      console.log(`Pipeline cancelled for ${questionFileId}, skipping processing`);
      return {
        ok: true,
        opportunityId,
        cancelled: true,
        updatedFieldCount: 0,
      };
    }
  }

  if (!projectId || !questionFileId || !textFileKey || !opportunityId) {
    throw new Error('Provide a valid projectId or questionFileId or textFileKey');
  }
  const { orgId } = await getQuestionFileItem(projectId, opportunityId, questionFileId) || {};

  if (!orgId) {
    throw new Error('Provide a valid orgId');
  }

  try {
    // Check if opportunity source is SAM_GOV
    const opportunityArgs = {
      orgId,
      projectId,
      oppId: opportunityId
    };
    const opportunity = await getOpportunity(opportunityArgs);
    
    if (opportunity?.item.source === 'SAM_GOV') {
      console.log(`Skipping opportunity field fulfillment for SAM_GOV opportunity: ${opportunityId}`);
      
      // Mark question file as processed and return success
      await updateQuestionFile(projectId, opportunityId, questionFileId, {
        status: 'PROCESSED',
      });
      
      return {
        ok: true,
        opportunityId,
        updatedFieldCount: 0,
        confidence: 100,
        skipped: true,
        reason: 'SAM_GOV opportunity - fields already populated from source',
      };
    }

    // Continue with normal processing for non-SAM_GOV opportunities
    const docText = await loadTextFromS3(DOCUMENTS_BUCKET, textFileKey);

    if (!docText || docText.length === 0) {
      throw new Error(`Empty document text from S3: ${textFileKey}`);
    }

    const bodyString = JSON.stringify(buildBedrockMessagesBody(docText));
    const responseBody = await invokeModel(BEDROCK_MODEL_ID, bodyString);
    const responseString = new TextDecoder('utf-8').decode(responseBody);
    const responseJson = JSON.parse(responseString);

    const rawText =
      responseJson?.content?.find?.((c: any) => c?.type === 'text')?.text ??
      responseJson?.output?.message?.content?.find?.((c: any) => c?.type === 'text')?.text ??
      responseJson?.completion ??
      null;

    const modelOut = rawText ? safeParseJsonFromModel(String(rawText)) : rawText;

    const fields = modelOut?.fields && typeof modelOut.fields === 'object' ? modelOut.fields : null;
    const confidence =
      typeof modelOut?.confidence === 'number' && Number.isFinite(modelOut.confidence)
        ? modelOut.confidence
        : undefined;

    if (!fields) {
      throw new Error('Bedrock did not return { fields: {...} }');
    }

    await updateOpportunity({
      orgId,
      projectId: projectId,
      oppId: opportunityId,
      patch: fields,
    });

    await updateQuestionFile(projectId, opportunityId, questionFileId, {
      status: 'PROCESSED',
    });

    return {
      ok: true,
      opportunityId,
      updatedFieldCount: Object.keys(fields).length,
      confidence,
      cancelled: false
    };
  } catch (e: any) {
    console.error(e);
    await updateQuestionFile(projectId, opportunityId, questionFileId, {
      status: 'FAILED',
      errorMessage: e?.message || '',
    });
    return {
      ok: false,
      opportunityId,
      oppId: opportunityId,
      updatedFieldCount: 0,
      confidence: 100,
      cancelled: false
    };
  }
};

export const handler = withSentryLambda(baseHandler);
