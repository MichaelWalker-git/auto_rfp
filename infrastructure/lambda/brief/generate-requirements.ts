import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { type ExecutiveBriefItem, RequirementsSectionSchema, } from '@auto-rfp/shared';

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
import { useRequirementsSystemPrompt, useRequirementsUserPrompt } from '../constants/prompt';

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  force: z.boolean().optional(),
  topK: z.number().int().min(1).max(100).optional(),
});


const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_SOLICITATION_CHARS = Number(process.env.BRIEF_MAX_SOLICITATION_CHARS ?? '45000');
const KB_TOPK_DEFAULT = Number(process.env.BRIEF_KB_TOPK ?? '20');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const COST_SAVING = Boolean(requireEnv('COST_SAVING', 'true'));

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  let executiveBriefId: string | undefined;

  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const parsedReq = RequestSchema.parse(bodyJson);
    executiveBriefId = parsedReq.executiveBriefId;

    const { force, topK } = parsedReq;

    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

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

    const kbMatches = COST_SAVING
      ? []
      : await queryCompanyKnowledgeBase(solicitationText, topK ?? KB_TOPK_DEFAULT);

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
      system: await useRequirementsSystemPrompt(orgId!),
      user: await useRequirementsUserPrompt(orgId!, solicitationText, kbText),
      outputSchema: RequirementsSectionSchema,
      maxTokens: 5000,
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
