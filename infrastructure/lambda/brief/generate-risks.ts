import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { type ExecutiveBriefItem, ExecutiveBriefItemSchema, RisksSectionSchema, } from '@auto-rfp/shared';

import {
  buildSectionInputHash,
  getExecutiveBrief,
  invokeClaudeJson,
  loadSolicitationForBrief,
  markSectionComplete,
  markSectionFailed,
  markSectionInProgress,
  truncateText,
} from '../helpers/executive-opportunity-frief';

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  force: z.boolean().optional(),
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_SOLICITATION_CHARS = Number(process.env.BRIEF_MAX_SOLICITATION_CHARS ?? '45000');

function buildSystemPrompt(): string {
  return [
    'You are a government contracting capture and compliance analyst.',
    'Identify risks and red flags for a bid/no-bid decision.',
    '',
    'STRICT OUTPUT CONTRACT (MUST FOLLOW):',
    '- Output ONLY a single valid JSON object.',
    '- Do NOT output any text before "{" or after "}".',
    '- No prose, no markdown, no code fences.',
    '- The first character MUST be "{" and the last character MUST be "}".',
    '- JSON must match the RisksSection schema exactly. Do NOT add extra keys.',
    '',
    'EVIDENCE FORMAT (IMPORTANT):',
    '- evidence MUST be an array of objects (NOT strings).',
    '- EvidenceRef object keys allowed: source, snippet, chunkKey, documentId.',
    '- Use "snippet" for short quotes from the solicitation.',
    '- If you cannot cite evidence for an item, DO NOT include the item (omit it).',
    '',
    'CONTENT RULES:',
    '- Do not invent facts.',
    '- If uncertain, phrase as "potential risk" and include evidence.',
    '- Prefer specific, actionable mitigations.',
    '- severity must be one of LOW, MEDIUM, HIGH, CRITICAL.',
    '- impactsScore should be true for HIGH/CRITICAL unless clearly not impacting score.',
  ].join('\n');
}

function buildUserPrompt(args: { solicitationText: string }): string {
  const { solicitationText } = args;

  return [
    'TASK: Produce a risk assessment for an Executive Opportunity Brief.',
    '',
    'Return JSON ONLY. First char "{" last char "}".',
    '',
    'OUTPUT JSON must match the RisksSection schema exactly, with keys:',
    '- risks: RiskFlag[]',
    '- redFlags: RiskFlag[]',
    '- incumbentInfo: { knownIncumbent, incumbentName?, recompete, notes?, evidence[] }',
    '',
    'RiskFlag schema (conceptual):',
    '{ "severity": "LOW|MEDIUM|HIGH|CRITICAL", "flag": "...", "whyItMatters"?: "...", "mitigation"?: "...", "impactsScore": true|false, "evidence": EvidenceRef[] }',
    '',
    'EvidenceRef MUST be objects (NOT strings):',
    '{ "source": "SOLICITATION", "snippet": "short quote" }',
    '',
    'INCLUDE ITEMS FOR (examples):',
    '- Very short response window / unrealistic schedule',
    '- Mandatory site visits or orals with tight dates',
    '- Strong incumbent advantage / recompete indicators / brand-name language',
    '- Excessive compliance burden (many attachments, strict page limits, unique formats)',
    '- Security clearances, certifications, facility requirements (potential blockers)',
    '- Harsh terms (liquidated damages, extreme SLAs, unusual insurance)',
    '',
    'RULES:',
    '- Do not invent risks.',
    '- If no evidence for an item, omit it (do not include it with empty evidence).',
    '- Keep flags short and specific; mitigations actionable.',
    '',
    'SOLICITATION TEXT:',
    solicitationText,
  ].join('\n');
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  let executiveBriefId: string | undefined;

  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const parsedReq = RequestSchema.parse(bodyJson);
    executiveBriefId = parsedReq.executiveBriefId;

    const { force } = parsedReq;

    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    ExecutiveBriefItemSchema.parse(brief);

    const inputHash = buildSectionInputHash({
      executiveBriefId,
      section: 'risks',
      questionFileId: brief.questionFileId,
      textKey: brief.textKey,
    });

    const existing = (brief.sections as any)?.risks;
    if (!force && existing?.status === 'COMPLETE' && existing?.inputHash === inputHash) {
      return apiResponse(200, {
        ok: true,
        executiveBriefId,
        section: 'risks',
        status: existing.status,
        reused: true,
      });
    }

    await markSectionInProgress({
      executiveBriefId,
      section: 'risks',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: buildSystemPrompt(),
      user: buildUserPrompt({ solicitationText }),
      outputSchema: RisksSectionSchema,
      maxTokens: 1800,
      temperature: 0.2,
    });

    // Small normalization: if something is CRITICAL but impactsScore missing, set it true.
    const normalize = (items: any[]) =>
      (items ?? []).map((r) => ({
        ...r,
        impactsScore:
          typeof r.impactsScore === 'boolean'
            ? r.impactsScore
            : ['HIGH', 'CRITICAL'].includes(r.severity),
      }));

    const normalized = {
      ...data,
      risks: normalize((data as any).risks),
      redFlags: normalize((data as any).redFlags),
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'risks',
      data: normalized,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });

    return apiResponse(200, {
      ok: true,
      executiveBriefId,
      section: 'risks',
      status: 'COMPLETE',
    });
  } catch (err) {
    if (executiveBriefId) {
      try {
        await markSectionFailed({
          executiveBriefId,
          section: 'risks',
          error: err,
        });
      } catch {
        // ignore
      }
    }

    console.error('generate-risks error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
