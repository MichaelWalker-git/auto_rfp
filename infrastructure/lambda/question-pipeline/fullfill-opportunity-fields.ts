import { requireEnv } from '../helpers/env';
import { loadTextFromS3 } from '../helpers/s3';
import { invokeModel } from '../helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '../helpers/json';
import { updateOpportunity } from '../helpers/opportunity';
import { getQuestionFileItem } from '../helpers/questionFile';
import { withSentryLambda } from '../sentry-lambda';

type Event = {
  opportunityId: string;
  textFileKey: string;
  projectId?: string;
  questionFileId?: string;
};

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

const buildPrompt = (docText: string) => {
  // Keep prompt stable and JSON-only to simplify parsing & updating.
  return [
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text:
            'You extract and normalize government procurement opportunity metadata from raw solicitation text. ' +
            'Return ONLY valid JSON (no markdown, no commentary).',
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
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
            docText.slice(0, 180_000), // guardrail to avoid huge payloads
        },
      ],
    },
  ];
};

// TODO Kate
export const baseHandler = async (event: Event) => {
  const { opportunityId, projectId, questionFileId, textFileKey, } = event;
  if (!projectId || !questionFileId || !textFileKey) {
    throw new Error('Provide a valid projectId or questionFileId or textFileKey');
  }

  const { orgId } = await getQuestionFileItem(projectId, questionFileId) || {};

  if (!orgId) {
    throw new Error('Provide a valid orgId');
  }

  const docText = await loadTextFromS3(DOCUMENTS_BUCKET, textFileKey);
  const messages = buildPrompt(docText);
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1200,
    temperature: 0,
    messages,
  };

  const responseBody = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(body));
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
    oppId: opportunityId,
    projectId: projectId,
    patch: fields,
  });

  return {
    ok: true,
    opportunityId,
    updatedFieldCount: Object.keys(fields).length,
    confidence,
  };
};

const handler = withSentryLambda(baseHandler);
