import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { type ExecutiveBriefItem, ExecutiveBriefItemSchema, ScoringSectionSchema, } from '@auto-rfp/shared';

import {
  buildSectionInputHash,
  computeOverallStatus,
  getExecutiveBrief,
  invokeClaudeJson,
  loadSolicitationForBrief,
  markSectionComplete,
  markSectionFailed,
  markSectionInProgress,
  queryCompanyKnowledgeBase,
  truncateText,
} from '../helpers/executive-opportunity-frief';

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  force: z.boolean().optional(),
  topK: z.number().int().min(1).max(100).optional(),
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_SOLICITATION_CHARS = Number(process.env.BRIEF_MAX_SOLICITATION_CHARS ?? '45000');
const KB_TOPK_DEFAULT = Number(process.env.BRIEF_KB_TOPK ?? '30');

function buildSystemPrompt(): string {
  return [
    'You are a senior capture director deciding bid/no-bid in 5 minutes.',
    '',
    'STRICT OUTPUT CONTRACT (MUST FOLLOW):',
    '- Output ONLY a single valid JSON object.',
    '- Do NOT output any text before "{" or after "}".',
    '- No prose, no markdown, no code fences.',
    '- The first character MUST be "{" and the last character MUST be "}".',
    '- JSON must match the ScoringSection schema exactly. Do NOT add extra keys.',
    '',
    'SCORING RULES:',
    '- You MUST output exactly 5 criteria entries, one per required name:',
    '  TECHNICAL_FIT, PAST_PERFORMANCE_RELEVANCE, PRICING_POSITION, STRATEGIC_ALIGNMENT, INCUMBENT_RISK',
    '- Do not duplicate names. Do not omit any.',
    '- Each score must be an integer 1..5.',
    '- rationale must be at least 10 characters.',
    '- If something is unknown, add a gap string and reduce confidence.',
    '',
    'EVIDENCE FORMAT (IMPORTANT):',
    '- evidence MUST be an array of objects (NOT strings).',
    '- EvidenceRef keys allowed: source, snippet, chunkKey, documentId.',
    '- Use snippet for short quotes from solicitation.',
    '- Use chunkKey/documentId when referencing KB excerpts.',
    '- If no evidence, use [].',
    '',
    'NON-HALLUCINATION RULE:',
    '- Do not invent facts. Base scoring on the provided extracted sections, solicitation text, and KB excerpts only.',
  ].join('\n');
}

function buildUserPrompt(args: {
  solicitationText: string;
  brief: ExecutiveBriefItem;
  kbText: string;
}): string {
  const { solicitationText, brief, kbText } = args;

  const summary = (brief.sections as any)?.summary?.data;
  const deadlines = (brief.sections as any)?.deadlines?.data;
  const requirements = (brief.sections as any)?.requirements?.data;
  const contacts = (brief.sections as any)?.contacts?.data;
  const risks = (brief.sections as any)?.risks?.data;

  return [
    'TASK: Produce Bid/No-Bid scoring and final recommendation for an Executive Opportunity Brief.',
    '',
    'Return JSON ONLY. First char "{" last char "}".',
    '',
    'COPY THIS JSON SKELETON AND FILL IT IN (do not add keys):',
    '{',
    '  "criteria": [',
    '    {',
    '      "name": "TECHNICAL_FIT",',
    '      "score": 3,',
    '      "rationale": "string (>=10 chars)",',
    '      "gaps": [],',
    '      "evidence": [ { "source": "SOLICITATION", "snippet": "short quote" } ]',
    '    },',
    '    { "name": "PAST_PERFORMANCE_RELEVANCE", "score": 3, "rationale": "string", "gaps": [], "evidence": [] },',
    '    { "name": "PRICING_POSITION", "score": 3, "rationale": "string", "gaps": [], "evidence": [] },',
    '    { "name": "STRATEGIC_ALIGNMENT", "score": 3, "rationale": "string", "gaps": [], "evidence": [] },',
    '    { "name": "INCUMBENT_RISK", "score": 3, "rationale": "string", "gaps": [], "evidence": [] }',
    '  ],',
    '  "compositeScore": 3.0,',
    '  "recommendation": "NEEDS_REVIEW",',
    '  "confidence": 70,',
    '  "summaryJustification": "string (>=20 chars)"',
    '}',
    '',
    'GUIDANCE:',
    '- Score each criterion 1..5 based ONLY on the provided data below.',
    '- If extracted sections are missing important info, add that to gaps[] and reduce confidence.',
    '- Recommendation:',
    '  - GO: strong fit, manageable risk, realistic deadlines',
    '  - NO_GO: clear blockers, heavy incumbent lock, impossible schedule, misalignment',
    '  - NEEDS_REVIEW: incomplete info or moderate risk requiring human judgment',
    '- Confidence (0-100): start 85 and subtract for gaps/unknowns.',
    '',
    'EVIDENCE RULE:',
    '- evidence[] MUST be objects (NOT strings). Use snippet for solicitation quotes.',
    '- For KB evidence, include chunkKey/documentId when possible.',
    '',
    'KNOWN EXTRACTED SECTIONS (may be partial):',
    'SUMMARY:',
    JSON.stringify(summary ?? null, null, 2),
    '',
    'DEADLINES:',
    JSON.stringify(deadlines ?? null, null, 2),
    '',
    'REQUIREMENTS:',
    JSON.stringify(requirements ?? null, null, 2),
    '',
    'CONTACTS:',
    JSON.stringify(contacts ?? null, null, 2),
    '',
    'RISKS:',
    JSON.stringify(risks ?? null, null, 2),
    '',
    'COMPANY KNOWLEDGE BASE EXCERPTS (past performance, capabilities, etc.):',
    kbText ? kbText : '[NO_KB_CONTEXT]',
    '',
    'SOLICITATION TEXT (for grounding / final checks):',
    solicitationText,
  ].join('\n');
}

function average(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  let executiveBriefId: string | undefined;

  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const parsedReq = RequestSchema.parse(bodyJson);
    executiveBriefId = parsedReq.executiveBriefId;

    const { force, topK } = parsedReq;

    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    ExecutiveBriefItemSchema.parse(brief);

    const inputHash = buildSectionInputHash({
      executiveBriefId,
      section: 'scoring',
      questionFileId: brief.questionFileId,
      textKey: brief.textKey,
    });

    const existing = (brief.sections as any)?.scoring;
    if (!force && existing?.status === 'COMPLETE' && existing?.inputHash === inputHash) {
      return apiResponse(200, {
        ok: true,
        executiveBriefId,
        section: 'scoring',
        status: existing.status,
        reused: true,
      });
    }

    await markSectionInProgress({
      executiveBriefId,
      section: 'scoring',
      inputHash,
    });

    // For scoring, we still load solicitation text for grounding
    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    // KB context for past performance relevance
    const kbMatches = await queryCompanyKnowledgeBase({
      solicitationText,
      topK: topK ?? KB_TOPK_DEFAULT,
    });

    const kbText = (kbMatches ?? [])
      .slice(0, topK ?? KB_TOPK_DEFAULT)
      .map((m, i) => {
        const header = `#${i + 1} score=${m.score}${m.documentId ? ` doc=${m.documentId}` : ''}${
          m.chunkKey ? ` chunkKey=${m.chunkKey}` : ''
        }`;
        const text = m.text ? truncateText(m.text, 2500) : '';
        return [header, text].filter(Boolean).join('\n');
      })
      .join('\n\n');

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: buildSystemPrompt(),
      user: buildUserPrompt({ solicitationText, brief, kbText }),
      outputSchema: ScoringSectionSchema,
      maxTokens: 1900,
      temperature: 0.2,
    });

    // Compute composite if model gave something slightly inconsistent
    const scores = data.criteria.map((c) => c.score);
    const computedComposite = Math.round(average(scores) * 10) / 10; // 1 decimal is handy; schema allows number
    const normalized = {
      ...data,
      compositeScore: computedComposite,
    };

    // Update overall status: COMPLETE only if all sections complete (including scoring)
    const nextSections: any = {
      ...brief.sections,
      scoring: { ...(brief.sections as any).scoring, status: 'COMPLETE' },
    };
    const overall = computeOverallStatus(nextSections);

    await markSectionComplete({
      executiveBriefId,
      section: 'scoring',
      data: normalized,
      topLevelPatch: {
        compositeScore: normalized.compositeScore,
        recommendation: normalized.recommendation,
        confidence: normalized.confidence,
        status: overall, // likely COMPLETE if others done
      },
    });

    return apiResponse(200, {
      ok: true,
      executiveBriefId,
      section: 'scoring',
      status: 'COMPLETE',
      compositeScore: normalized.compositeScore,
      recommendation: normalized.recommendation,
      confidence: normalized.confidence,
      overallStatus: overall,
    });
  } catch (err) {
    if (executiveBriefId) {
      try {
        await markSectionFailed({
          executiveBriefId,
          section: 'scoring',
          error: err,
        });
      } catch {
        // ignore
      }
    }

    console.error('generate-scoring error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
