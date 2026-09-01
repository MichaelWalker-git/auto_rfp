import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getRequiredForm } from '@/helpers/required-form';
import { getCompanyProfile } from '@/helpers/company-profile';
import { gatherAllContext } from '@/helpers/document-context';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { requireEnv } from '@/helpers/env';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const BodySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  formId: z.string().min(1),
  fieldId: z.string().min(1),
  /**
   * Optional override for the field label. The frontend sends the latest
   * locally-edited label so the AI uses the user's renamed wording even
   * before the form has been saved.
   */
  labelOverride: z.string().optional(),
});

const ModelOutputSchema = z.object({
  value: z.string().nullable(),
  source: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});

const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

const buildPrompt = (args: {
  fieldLabel: string;
  formName: string;
  profileJson: string;
  knowledgeContext: string;
}) => {
  const { fieldLabel, formName, profileJson, knowledgeContext } = args;
  const userText = [
    `Form: ${formName}`,
    `Field label: "${fieldLabel}"`,
    '',
    'COMPANY PROFILE:',
    profileJson,
    '',
    knowledgeContext ? 'KNOWLEDGE BASE / CONTENT LIBRARY:' : '',
    knowledgeContext.slice(0, 60_000),
    '',
    'Determine the best value to fill in this field for a US-government vendor form.',
    '',
    'Rules:',
    '- Use ONLY values present in the company profile or knowledge base above.',
    '- NEVER invent values.',
    '- If the field is a signature, contract/project number, policy number, COI date, or anything opportunity-specific, return value=null with a reason.',
    '- If multiple values could plausibly match, prefer the most authoritative (e.g. legalEntityName over dba unless the form says "DBA").',
    '',
    'Return ONLY this JSON:',
    '{ "value": string | null, "source": string, "confidence": number, "reason": string }',
    '',
    '- "source": where the value came from (e.g. "companyName", "knowledgeBase", "fields.einLetterDate", "today").',
    '- "confidence": 0-1.',
    '- "reason": short note shown to the user when value is null OR when confidence is < 0.7.',
  ].join('\n');

  return {
    anthropic_version: 'bedrock-2023-05-31',
    system: 'You autofill one field on a US-government vendor form. Output ONLY valid JSON, no markdown.',
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
    max_tokens: 1000,
  };
};

const buildProfileSummary = (profile: unknown): string => {
  if (!profile || typeof profile !== 'object') return '{}';
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return JSON.stringify(out, null, 2);
};

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const raw = event.body ? JSON.parse(event.body) : {};
  const { success, data, error } = BodySchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid body', issues: error.issues });

  const form = await getRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
  });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  const field = form.fields.find((f) => f.fieldId === data.fieldId);
  // Allow new fields the user just created in the UI (not yet persisted) to use AI fill —
  // the frontend supplies labelOverride for those.
  const fieldLabel = data.labelOverride?.trim() || field?.label;
  if (!fieldLabel) return apiResponse(404, { message: 'Field not found on form' });

  const [profile, knowledgeContext] = await Promise.all([
    getCompanyProfile(orgId),
    gatherAllContext({
      orgId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      solicitation: fieldLabel, // tiny query — KB ranker will use the label as the search seed
    }).catch((err) => {
      console.warn('[ai-fill-field] KB context load failed (non-fatal):', (err as Error)?.message);
      return '';
    }),
  ]);

  if (!profile) {
    return apiResponse(200, {
      value: null,
      source: 'none',
      confidence: 0,
      reason: 'Company profile not configured',
    });
  }

  const prompt = buildPrompt({
    fieldLabel,
    formName: form.name,
    profileJson: buildProfileSummary(profile),
    knowledgeContext,
  });

  let rawText: string | null = null;
  try {
    const responseBody = await invokeModel(getBedrockModelId(), JSON.stringify(prompt), orgId);
    const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
    const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? null;
  } catch (err) {
    console.error('[ai-fill-field] Bedrock call failed:', (err as Error)?.message);
    return apiResponse(502, { message: 'AI service unavailable' });
  }

  let parsed: z.infer<typeof ModelOutputSchema> | null = null;
  if (rawText) {
    try {
      const candidate = safeParseJsonFromModel(rawText);
      const result = ModelOutputSchema.safeParse(candidate);
      if (result.success) parsed = result.data;
    } catch (err) {
      console.warn('[ai-fill-field] Could not parse model JSON:', (err as Error)?.message);
    }
  }

  if (!parsed) {
    return apiResponse(200, {
      value: null,
      source: 'none',
      confidence: 0,
      reason: 'AI did not return a usable response',
    });
  }

  return apiResponse(200, parsed);
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
