import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { DeadlinesSectionSchema, type ExecutiveBriefItem, ExecutiveBriefItemSchema, } from '@auto-rfp/shared';

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

const CLAUDE_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_SOLICITATION_CHARS = Number(process.env.BRIEF_MAX_SOLICITATION_CHARS ?? '45000');

function buildSystemPrompt(): string {
  return [
    'You extract deadlines from government solicitations.',
    '',
    'STRICT OUTPUT CONTRACT (MUST FOLLOW):',
    '- Output ONLY a single valid JSON object. No prose, no markdown, no code fences.',
    '- The first character MUST be "{" and the last character MUST be "}".',
    '- JSON must match the DeadlinesSection schema exactly. Do NOT add extra keys.',
    '',
    'CRITICAL VALIDATION RULES:',
    '- dateTimeIso and submissionDeadlineIso MUST be ISO-8601 datetime strings if present.',
    '- Valid examples: "2026-01-15T17:00:00Z" or "2026-01-15T17:00:00-05:00".',
    '- If you cannot confidently produce a valid ISO datetime, OMIT dateTimeIso/submissionDeadlineIso and use rawText + notes.',
    '',
    'EVIDENCE RULES:',
    '- evidence MUST be an array of objects, not strings.',
    '- EvidenceRef object keys allowed: source, snippet, chunkKey, documentId.',
    '- Use snippet for short quotes from the solicitation. If unknown, use [].',
    '',
    'CONTENT RULES:',
    '- Do not invent deadlines.',
    '- Extract ALL deadlines mentioned (not just proposal due).',
    '- If multiple dates/times exist, include multiple deadline entries.',
  ].join('\n');
}

function buildUserPrompt(args: { solicitationText: string }): string {
  const { solicitationText } = args;

  return [
    'TASK: Extract ALL deadlines from this solicitation.',
    '',
    'Return JSON ONLY. First char "{" last char "}".',
    '',
    'Use these deadline type values (prefer these exact words):',
    '- PROPOSAL_DUE',
    '- QUESTIONS_DUE',
    '- SITE_VISIT',
    '- PRE_PROPOSAL_CONFERENCE',
    '- AMENDMENT_CUTOFF',
    '- ORALS',
    '- AWARD_ESTIMATE',
    '- OTHER',
    '',
    'COPY THIS JSON SKELETON AND FILL IT IN (do not add keys):',
    '{',
    '  "deadlines": [',
    '    {',
    '      "type": "PROPOSAL_DUE",',
    '      "label": "Proposal submission deadline",',
    '      "dateTimeIso": "2026-01-15T17:00:00Z",',
    '      "rawText": "optional original text",',
    '      "timezone": "ET",',
    '      "notes": "optional",',
    '      "evidence": [ { "source": "SOLICITATION", "snippet": "short quote" } ]',
    '    }',
    '  ],',
    '  "hasSubmissionDeadline": true,',
    '  "submissionDeadlineIso": "2026-01-15T17:00:00Z",',
    '  "warnings": []',
    '}',
    '',
    'IMPORTANT:',
    '- If you are NOT 100% sure of the ISO datetime, OMIT dateTimeIso and use rawText + notes instead.',
    '- If timezone is not explicit, omit timezone and add a warning like "No explicit timezone found".',
    '- evidence[] must be objects with "snippet" (NOT strings). Use [] if you cannot quote.',
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
      section: 'deadlines',
      questionFileId: brief.questionFileId,
      textKey: brief.textKey,
    });

    const existing = (brief.sections as any)?.deadlines;
    if (!force && existing?.status === 'COMPLETE' && existing?.inputHash === inputHash) {
      return apiResponse(200, {
        ok: true,
        executiveBriefId,
        section: 'deadlines',
        status: existing.status,
        reused: true,
      });
    }

    await markSectionInProgress({
      executiveBriefId,
      section: 'deadlines',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const data = await invokeClaudeJson({
      modelId: CLAUDE_MODEL_ID,
      system: buildSystemPrompt(),
      user: buildUserPrompt({ solicitationText }),
      outputSchema: DeadlinesSectionSchema,
      // Deadlines can be verbose; keep some room.
      maxTokens: 1600,
      temperature: 0.1,
    });

    // Lightweight post-processing safety:
    // Ensure hasSubmissionDeadline aligns with submissionDeadlineIso if present.
    const normalized = {
      ...data,
      hasSubmissionDeadline:
        data.hasSubmissionDeadline || Boolean((data as any).submissionDeadlineIso),
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'deadlines',
      data: normalized,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });

    return apiResponse(200, {
      ok: true,
      executiveBriefId,
      section: 'deadlines',
      status: 'COMPLETE',
    });
  } catch (err) {
    if (executiveBriefId) {
      try {
        await markSectionFailed({
          executiveBriefId,
          section: 'deadlines',
          error: err,
        });
      } catch {
        // ignore
      }
    }

    console.error('generate-deadlines error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
