import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse, getOrgId } from '../helpers/api';
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
} from '../helpers/executive-opportunity-brief';
import { useRiskSystemPrompt, useRiskUserPrompt } from '../constants/prompt';

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

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  let executiveBriefId: string | undefined;

  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const parsedReq = RequestSchema.parse(bodyJson);
    executiveBriefId = parsedReq.executiveBriefId;

    const { force } = parsedReq;

    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

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
      system: await useRiskSystemPrompt(orgId!),
      user: await useRiskUserPrompt(orgId!, solicitationText),
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
