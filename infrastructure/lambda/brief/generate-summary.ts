import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse, getOrgId } from '../helpers/api';

import { type ExecutiveBriefItem, ExecutiveBriefItemSchema, QuickSummarySchema, } from '@auto-rfp/shared';

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
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { loadTextFromS3 } from '../helpers/s3';
import { getSummarySystemPrompt, useSummaryUserPrompt } from '../constants/prompt';

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  force: z.boolean().optional(),
  topK: z.number().int().min(1).max(100).optional(),
});

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_SOLICITATION_CHARS = Number(requireEnv('BRIEF_MAX_SOLICITATION_CHARS', '45000'));
const KB_TOPK_DEFAULT = Number(requireEnv('BRIEF_KB_TOPK', '20'));
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const COST_SAVING = Boolean(requireEnv('COST_SAVING', 'true'));

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { executiveBriefId, force, topK } = JSON.parse(event.body || '');
    const orgId = getOrgId(event);

    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const existing = brief.sections.summary as any;
    const inputHash = buildSectionInputHash({
      executiveBriefId,
      section: 'summary',
      questionFileId: brief.questionFileId,
      textKey: brief.textKey,
    });

    if (!force && existing?.status === 'COMPLETE' && existing?.inputHash === inputHash) {
      return apiResponse(200, {
        ok: true,
        executiveBriefId,
        section: 'summary',
        status: existing.status,
        reused: true,
      });
    }

    // Mark IN_PROGRESS (stores inputHash for idempotency)
    await markSectionInProgress({
      executiveBriefId,
      section: 'summary',
      inputHash,
    });

    // Load solicitation text
    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    // Optional: fetch KB context (useful for title/agency normalization + capability alignment hints)
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

    // Call Claude -> validated JSON
    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await getSummarySystemPrompt(orgId!),
      user: await useSummaryUserPrompt(orgId!, solicitationText, kbText, JSON.stringify(QuickSummarySchema.shape, null, 2)),
      outputSchema: QuickSummarySchema,
      maxTokens: 1200,
      temperature: 0.2,
    });

    // Store section as COMPLETE
    await markSectionComplete({
      executiveBriefId,
      section: 'summary',
      data,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });

    return apiResponse(200, {
      ok: true,
      executiveBriefId,
      section: 'summary',
      status: 'COMPLETE',
    });
  } catch (err) {
    try {
      const bodyJson = event.body ? JSON.parse(event.body) : {};
      const parsed = RequestSchema.safeParse(bodyJson);
      if (parsed.success) {
        await markSectionFailed({
          executiveBriefId: parsed.data.executiveBriefId,
          section: 'summary',
          error: err,
        });
      }
    } catch {
      // ignore secondary failures
    }

    console.error('generate-summary error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
