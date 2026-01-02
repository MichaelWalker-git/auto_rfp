import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { type ExecutiveBriefItem, ExecutiveBriefItemSchema, RequirementsSectionSchema, } from '@auto-rfp/shared';

import {
  buildSectionInputHash,
  getExecutiveBrief,
  invokeClaudeJson,
  loadSolicitationForBrief,
  markSectionComplete,
  markSectionFailed,
  markSectionInProgress,
  queryCompanyKnowledgeBase,
  truncateText,
} from '../helpers/executive-opportunity-brief';
import { loadTextFromS3 } from '../helpers/s3';
import { requireEnv } from '../helpers/env';

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  force: z.boolean().optional(),
  topK: z.number().int().min(1).max(100).optional(),
});


const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_SOLICITATION_CHARS = Number(process.env.BRIEF_MAX_SOLICITATION_CHARS ?? '45000');
const KB_TOPK_DEFAULT = Number(process.env.BRIEF_KB_TOPK ?? '20');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

function buildSystemPrompt(): string {
  return [
    'You summarize requirements from government solicitations for bid/no-bid decisions.',
    '',
    'STRICT OUTPUT CONTRACT (MUST FOLLOW):',
    '- Output ONLY a single valid JSON object.',
    '- Do NOT output any text before "{" or after "}".',
    '- No prose, no markdown, no code fences, no commentary.',
    '- The first character of your response MUST be "{" and the last character MUST be "}".',
    '- The JSON must match the RequirementsSection schema exactly. Do NOT add extra keys.',
    '',
    'SCHEMA CONSTRAINTS:',
    '- overview: string (min 10 chars).',
    '- requirements: array with at least 1 item.',
    '- Each requirement item: { category?: string, requirement: string (min 5), mustHave: boolean, evidence: EvidenceRef[] }',
    '- deliverables: string[] (can be empty).',
    '- evaluationFactors: string[] (can be empty).',
    '- submissionCompliance: { format: string[], requiredVolumes: string[], attachmentsAndForms: string[] }',
    '',
    'EVIDENCE FORMAT (IMPORTANT):',
    '- evidence is an array of objects (NOT strings).',
    '- EvidenceRef object keys you may use: source, snippet, chunkKey, documentId.',
    '- Use "snippet" for short quotes.',
    '- If no evidence, use an empty array [].',
    '',
    'CONTENT RULES:',
    '- Do not invent requirements. If unclear, omit or use category "OTHER".',
    '- Prefer concise requirement strings (short, imperative).',
    '- Focus on: technical requirements, deliverables, compliance/submission rules, evaluation factors.',
  ].join('\n');
}

function buildUserPrompt(args: { solicitationText: string; kbText: string }): string {
  const { solicitationText, kbText } = args;

  return [
    'TASK: Build a detailed requirements summary for an Executive Opportunity Brief.',
    '',
    'IMPORTANT:',
    '- Return JSON ONLY.',
    '- First character MUST be "{" and last character MUST be "}".',
    '',
    'COPY THIS JSON SKELETON AND FILL IT IN (do not add keys):',
    '{',
    '  "overview": "string (min 10 chars)",',
    '  "requirements": [',
    '    {',
    '      "category": "TECHNICAL",',
    '      "requirement": "string (min 5 chars)",',
    '      "mustHave": true,',
    '      "evidence": [',
    '        { "source": "SOLICITATION", "snippet": "short quote" }',
    '      ]',
    '    }',
    '  ],',
    '  "deliverables": [],',
    '  "evaluationFactors": [],',
    '  "submissionCompliance": {',
    '    "format": [],',
    '    "requiredVolumes": [],',
    '    "attachmentsAndForms": []',
    '  }',
    '}',
    '',
    'REQUIRED CONTENT:',
    '- A short overview of what is being procured and what success looks like.',
    '- Requirements categorized (TECHNICAL / SECURITY / COMPLIANCE / DELIVERABLES / STAFFING / OTHER).',
    '- Deliverables list (if explicit).',
    '- Evaluation factors list (if explicit).',
    '- Submission compliance rules: page limits, formatting, required volumes, attachments/forms, portals, file naming.',
    '',
    'RULES:',
    '- "mustHave" should be true if the solicitation makes it mandatory.',
    '- evidence[] must be objects with "snippet" (not strings). Use [] if no quote.',
    '- Do not add company marketing; only summarize the solicitation.',
    '',
    'COMPANY CONTEXT (KB excerpts; may be empty):',
    kbText ? kbText : '[NO_KB_CONTEXT]',
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

    const { force, topK } = parsedReq;

    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    ExecutiveBriefItemSchema.parse(brief);

    const inputHash = buildSectionInputHash({
      executiveBriefId,
      section: 'requirements',
      questionFileId: brief.questionFileId,
      textKey: brief.textKey,
    });

    const existing = (brief.sections as any)?.requirements;
    if (!force && existing?.status === 'COMPLETE' && existing?.inputHash === inputHash) {
      return apiResponse(200, {
        ok: true,
        executiveBriefId,
        section: 'requirements',
        status: existing.status,
        reused: true,
      });
    }

    await markSectionInProgress({
      executiveBriefId,
      section: 'requirements',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const kbMatches = await queryCompanyKnowledgeBase(solicitationText, topK ?? KB_TOPK_DEFAULT);

    const kbText = (kbMatches ?? [])
      .slice(0, topK ?? KB_TOPK_DEFAULT)
      .map(async (m, i) => {
        const header = `#${i + 1} score=${m._score}${m._source?.documentId ? ` doc=${m._source.documentId}` : ''}${
          m._source?.chunkKey ? ` chunkKey=${m._source?.chunkKey}` : ''
        }`;
        const text = m._source?.chunkKey
          ? await loadTextFromS3(DOCUMENTS_BUCKET, m._source?.chunkKey)
          : '';
        return [header, text].filter(Boolean).join('\n');
      })
      .join('\n\n');

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: buildSystemPrompt(),
      user: buildUserPrompt({ solicitationText, kbText }),
      outputSchema: RequirementsSectionSchema,
      maxTokens: 2200,
      temperature: 0.2,
    });

    await markSectionComplete({
      executiveBriefId,
      section: 'requirements',
      data,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });

    return apiResponse(200, {
      ok: true,
      executiveBriefId,
      section: 'requirements',
      status: 'COMPLETE',
    });
  } catch (err) {
    if (executiveBriefId) {
      try {
        await markSectionFailed({
          executiveBriefId,
          section: 'requirements',
          error: err,
        });
      } catch {
        // ignore
      }
    }

    console.error('generate-requirements error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
