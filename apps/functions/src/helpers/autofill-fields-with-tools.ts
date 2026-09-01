import { invokeClaudeWithTools } from './bedrock-tool-loop';
import { requireEnv } from './env';

import type { CompanyProfileItem, DetectedFormField, FormFieldStatus } from '@auto-rfp/core';
import type { ToolDefinition, ToolResult } from '@/types/tool';

const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

const ALWAYS_MANUAL_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /signature/i, reason: 'Requires authorized signature' },
  { pattern: /sign\s*here/i, reason: 'Requires authorized signature' },
  { pattern: /authorized\s*sign/i, reason: 'Requires authorized signature' },
  { pattern: /\binitial(s)?\b/i, reason: 'Requires authorized initials' },
  { pattern: /notary/i, reason: 'Requires notary' },
  { pattern: /witness/i, reason: 'Requires witness' },
  { pattern: /contract\s*(no|number|#)/i, reason: 'Opportunity-specific — enter at submission time' },
  { pattern: /project\s*(name|no|number|#)/i, reason: 'Opportunity-specific — enter at submission time' },
  { pattern: /policy\s*number/i, reason: 'Insurance — verify current policy' },
  { pattern: /\binsurer\b/i, reason: 'Insurance — verify carrier' },
  { pattern: /insurance.*expir/i, reason: 'Insurance — verify expiration' },
  { pattern: /coi/i, reason: 'COI — verify before submission' },
  { pattern: /certificate.*insurance/i, reason: 'COI — verify before submission' },
];

// Match a label that asks for "today's date" / "date signed" / a bare "date" field —
// but NOT date-of-birth, expiration, effective date, etc., which need user input.
const TODAY_DATE_PATTERNS: RegExp[] = [
  /^date$/i,
  /^date:?\s*$/i,
  /\btoday'?s?\s*date\b/i,
  /date\s+signed/i,
  /date\s+of\s+signature/i,
  /signature\s+date/i,
];

const isTodayDateField = (label: string): boolean => {
  const trimmed = label.trim();
  return TODAY_DATE_PATTERNS.some((p) => p.test(trimmed));
};

const formatTodayDate = (): string => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
};

const HIGH_CONFIDENCE = 0.7;
const LOW_CONFIDENCE = 0.5;

const TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    name: 'fill_field',
    description:
      'Record an autofill for a form field. Only call this when the value is grounded in the company profile. ' +
      'Set confidence to a value in [0,1] reflecting your certainty: ' +
      '>=0.7 for unambiguous matches, 0.5–0.7 for plausible but imperfect, <0.5 means do NOT fill — call mark_manual instead.',
    input_schema: {
      type: 'object',
      properties: {
        fieldId: { type: 'string', description: 'The fieldId from the input field list.' },
        value: { type: 'string', description: 'The exact value to write into the field.' },
        profileFieldKey: {
          type: 'string',
          description:
            'The profile key the value came from (e.g. "companyName", "address", "fields.einLetterDate", "authorizedSignatory.name").',
        },
        confidence: { type: 'number', description: 'Confidence in [0,1].' },
      },
      required: ['fieldId', 'value', 'profileFieldKey', 'confidence'] as const,
    },
  },
  {
    name: 'mark_manual',
    description:
      'Flag a field that the human user must fill manually because no profile value is unambiguously appropriate ' +
      'or the field is opportunity-specific (signatures, dates of signing, contract numbers, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        fieldId: { type: 'string' },
        reason: { type: 'string', description: 'Short human-readable reason shown in the UI.' },
      },
      required: ['fieldId', 'reason'] as const,
    },
  },
];

const SYSTEM = [
  'You autofill fields on US-government vendor / contractor forms.',
  'You receive (a) the company profile JSON and (b) a list of unfilled form fields.',
  'For each field, call EXACTLY ONE tool: fill_field OR mark_manual.',
  '',
  'Hard rules:',
  '- Use ONLY values present in the profile. Never invent.',
  '- Always mark_manual for: signatures, dates of signing, contract/project numbers,',
  '  insurance policy numbers, COI / certificate-of-insurance fields, notary, witness.',
  '- If multiple profile values could match (e.g. ambiguous "Address"), prefer mark_manual unless context disambiguates.',
  '- After processing every field, output a JSON object: { "ok": true }.',
  '  Output exactly that — no other text.',
].join('\n');

const buildProfileSummary = (profile: CompanyProfileItem): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile)) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
};

const getProfileValue = (profile: CompanyProfileItem, key: string): string | null => {
  if (key.startsWith('fields.')) {
    const subKey = key.slice('fields.'.length);
    const f = profile.fields?.find((field) => field.key === subKey);
    return f?.value ?? null;
  }
  if (key.startsWith('authorizedSignatory.')) {
    const subKey = key.slice('authorizedSignatory.'.length) as keyof NonNullable<
      CompanyProfileItem['authorizedSignatory']
    >;
    return profile.authorizedSignatory?.[subKey] ?? null;
  }
  const v = (profile as unknown as Record<string, unknown>)[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ');
  return null;
};

const matchManualPattern = (label: string): string | null => {
  for (const { pattern, reason } of ALWAYS_MANUAL_PATTERNS) {
    if (pattern.test(label)) return reason;
  }
  return null;
};

const ackResult = { parse: <T>(v: T) => v as T };

export const autofillFieldsWithTools = async (
  fields: DetectedFormField[],
  profile: CompanyProfileItem,
  // Org scope for the Bedrock call. Threaded from docx-form-parser and the
  // textract-forms-callback worker (via form.orgId). Required (ticket 09) —
  // there is no shared-key fallback.
  orgId: string,
): Promise<DetectedFormField[]> => {
  if (fields.length === 0) return fields;

  // 1. Pre-decide fields the model should never see:
  //    - Already MANUAL_REQUIRED (signatures, checkboxes) → keep as-is
  //    - Always-manual labels (notary, contract #, COI…) → mark manual
  //    - "Date" labels asking for today → fill with today's date deterministically
  const decisions = new Map<string, DetectedFormField>();
  const candidates: DetectedFormField[] = [];
  const today = formatTodayDate();

  for (const f of fields) {
    if (f.status === 'MANUAL_REQUIRED') {
      decisions.set(f.fieldId, f);
      continue;
    }
    if (isTodayDateField(f.label)) {
      decisions.set(f.fieldId, {
        ...f,
        value: today,
        status: 'AUTO_FILLED' as FormFieldStatus,
        confidence: 1,
        profileFieldKey: 'today',
        manualReason: null,
      });
      continue;
    }
    const reason = matchManualPattern(f.label);
    if (reason) {
      decisions.set(f.fieldId, {
        ...f,
        status: 'MANUAL_REQUIRED' as FormFieldStatus,
        manualReason: reason,
      });
      continue;
    }
    candidates.push(f);
  }

  if (candidates.length === 0) {
    return fields.map((f) => decisions.get(f.fieldId) ?? f);
  }

  // 2. Run tool-use loop. Tool calls are recorded in the closure; the loop returns { ok: true }.
  const toolExecutor = async (
    name: string,
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<ToolResult> => {
    if (name === 'fill_field') {
      const fieldId = String(input.fieldId ?? '');
      const value = String(input.value ?? '');
      const profileFieldKey = String(input.profileFieldKey ?? '');
      const confidence = typeof input.confidence === 'number' ? input.confidence : 0;
      const original = candidates.find((c) => c.fieldId === fieldId);
      if (!original) {
        return { tool_use_id: toolUseId, content: `error: unknown fieldId ${fieldId}` };
      }
      // Validate the value actually exists in the profile (don't trust the LLM)
      const profileValue = getProfileValue(profile, profileFieldKey);
      if (!profileValue) {
        decisions.set(fieldId, {
          ...original,
          status: 'MANUAL_REQUIRED' as FormFieldStatus,
          manualReason: `No profile value for ${profileFieldKey}`,
        });
        return { tool_use_id: toolUseId, content: `error: profile has no value for ${profileFieldKey}` };
      }
      if (confidence < LOW_CONFIDENCE) {
        decisions.set(fieldId, {
          ...original,
          status: 'MANUAL_REQUIRED' as FormFieldStatus,
          manualReason: 'Low confidence — verify manually',
        });
        return { tool_use_id: toolUseId, content: `marked manual (confidence ${confidence} < ${LOW_CONFIDENCE})` };
      }
      const status: FormFieldStatus = confidence >= HIGH_CONFIDENCE ? 'AUTO_FILLED' : 'LOW_CONFIDENCE';
      decisions.set(fieldId, {
        ...original,
        value: profileValue,
        status,
        confidence,
        profileFieldKey,
      });
      return { tool_use_id: toolUseId, content: `ok: filled ${fieldId} from ${profileFieldKey} (${status})` };
    }

    if (name === 'mark_manual') {
      const fieldId = String(input.fieldId ?? '');
      const reason = String(input.reason ?? 'Manual review required');
      const original = candidates.find((c) => c.fieldId === fieldId);
      if (!original) {
        return { tool_use_id: toolUseId, content: `error: unknown fieldId ${fieldId}` };
      }
      decisions.set(fieldId, {
        ...original,
        status: 'MANUAL_REQUIRED' as FormFieldStatus,
        manualReason: reason,
      });
      return { tool_use_id: toolUseId, content: `ok: marked manual ${fieldId}` };
    }

    return { tool_use_id: toolUseId, content: `error: unknown tool ${name}` };
  };

  const userText = [
    'COMPANY PROFILE:',
    JSON.stringify(buildProfileSummary(profile), null, 2),
    '',
    'FIELDS TO PROCESS:',
    JSON.stringify(
      candidates.map((f) => ({ fieldId: f.fieldId, label: f.label, pageNumber: f.pageNumber })),
      null,
      2,
    ),
    '',
    'For each field, call fill_field or mark_manual. Then output {"ok": true}.',
  ].join('\n');

  try {
    await invokeClaudeWithTools({
      modelId: getBedrockModelId(),
      orgId,
      system: SYSTEM,
      user: userText,
      tools: TOOLS,
      toolExecutor,
      outputSchema: ackResult,
      maxTokens: 8000,
      temperature: 0,
      maxToolRounds: 3,
    });
  } catch (err) {
    console.warn('[autofill] tool-use loop failed (non-fatal):', (err as Error)?.message);
  }

  // 3. Merge decisions back over the input list. Anything not decided keeps its prior state.
  return fields.map((f) => decisions.get(f.fieldId) ?? f);
};
