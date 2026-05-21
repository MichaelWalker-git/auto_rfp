import { invokeModel } from './bedrock-http-client';
import { requireEnv } from './env';
import { getCompanyProfile } from './company-profile';
import { safeParseJsonFromModel } from './json';

import type { DetectedFormField } from '@auto-rfp/core';

const getModelId = () => requireEnv('BEDROCK_MODEL_ID');

const MIN_CONFIDENCE = 0.5;

type Capability = {
  key: string;
  label: string;
  value: string;
  notes: string | null;
};

type AutofillResponseEntry = {
  fieldId: string;
  value: string | null;
  confidence: number;
};

type AutofillArgs = {
  orgId: string;
  fields: DetectedFormField[];
};

const buildPrompt = (capabilities: Capability[], targets: DetectedFormField[]) => {
  const userText =
    'You are filling in the "Additional Information / Comments" column of a vendor compliance matrix.\n\n' +
    'For each FEATURE below, write a 1–3 sentence response describing how the company addresses that feature. ' +
    'Use ONLY information present in the CAPABILITIES list. ' +
    'If no capability clearly addresses a feature, return value=null and confidence=0.\n\n' +
    'CAPABILITIES (free-text entries from the company profile):\n' +
    JSON.stringify(capabilities, null, 2) +
    '\n\nFEATURES to fill:\n' +
    JSON.stringify(
      targets.map((t) => ({
        fieldId: t.fieldId,
        category: t.matrixCategory,
        feature: t.matrixFeature,
      })),
      null, 2,
    ) +
    '\n\nReturn JSON: { "responses": [ { "fieldId": "...", "value": "..." | null, "confidence": 0..1 } ] }\n' +
    'Return ONLY valid JSON (no markdown, no commentary).';

  return {
    anthropic_version: 'bedrock-2023-05-31',
    system:
      'You generate vendor capability statements for compliance matrices. ' +
      'Return ONLY valid JSON.',
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
    max_tokens: 4000,
  };
};

const parseModelResponse = (
  responseBody: Uint8Array,
  targets: DetectedFormField[],
): Map<string, AutofillResponseEntry> => {
  const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
  const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? null;
  const modelOut = rawText ? (safeParseJsonFromModel(String(rawText)) as Record<string, unknown>) : null;

  const out = new Map<string, AutofillResponseEntry>();
  if (!modelOut) return out;

  const responses = Array.isArray(modelOut.responses) ? modelOut.responses : [];
  const targetIds = new Set(targets.map((t) => t.fieldId));

  for (const r of responses as Array<Record<string, unknown>>) {
    const fieldId = typeof r.fieldId === 'string' ? r.fieldId : null;
    if (!fieldId || !targetIds.has(fieldId)) continue;
    const value = typeof r.value === 'string' && r.value.trim().length > 0 ? r.value.trim() : null;
    const confidence = typeof r.confidence === 'number' ? r.confidence : 0;
    out.set(fieldId, { fieldId, value, confidence });
  }

  return out;
};

/**
 * Auto-fill the Comments column of an XLSX response matrix using free-text
 * CompanyProfile CAPABILITY entries via Bedrock. Response columns
 * (Fully/Partially/Cannot Meet) are never touched — they stay MANUAL_REQUIRED.
 *
 * Returns a new fields array. Falls back to the original fields on any
 * error so a Bedrock outage doesn't block form ingestion.
 */
export const autofillMatrixComments = async ({
  orgId, fields,
}: AutofillArgs): Promise<DetectedFormField[]> => {
  const targets = fields.filter(
    (f) => f.matrixColumn === 'COMMENTS' && f.status === 'EMPTY' && !!f.matrixFeature,
  );
  if (targets.length === 0) return fields;

  const profile = await getCompanyProfile(orgId);
  const capabilities: Capability[] = (profile?.fields ?? [])
    .filter((f) => f.category === 'CAPABILITY')
    .map((f) => ({
      key: f.key,
      label: f.label,
      value: f.value,
      notes: f.notes ?? null,
    }));

  if (capabilities.length === 0) return fields;

  let responses: Map<string, AutofillResponseEntry>;
  try {
    const responseBody = await invokeModel(
      getModelId(),
      JSON.stringify(buildPrompt(capabilities, targets)),
    );
    responses = parseModelResponse(responseBody, targets);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`autofillMatrixComments: Bedrock call failed, leaving comments empty: ${message}`);
    return fields;
  }

  return fields.map((f) => {
    const match = responses.get(f.fieldId);
    if (!match) return f;
    if (match.value === null || match.confidence < MIN_CONFIDENCE) return f;
    return {
      ...f,
      value: match.value,
      status: 'AUTO_FILLED',
      confidence: match.confidence,
    };
  });
};
