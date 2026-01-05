import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { ContactsSectionSchema, type ExecutiveBriefItem, ExecutiveBriefItemSchema, } from '@auto-rfp/shared';

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
import { requireEnv } from '../helpers/env';
import { useContactsSystemPrompt, useContactsUserPrompt } from '../constants/prompt';

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const MAX_SOLICITATION_CHARS = Number(process.env.BRIEF_MAX_SOLICITATION_CHARS ?? '45000');

function computeMissingRoles(foundRoles: string[]): string[] {
  const recommended = [
    'CONTRACTING_OFFICER',
    'CONTRACT_SPECIALIST',
    'TECHNICAL_POC',
    'SMALL_BUSINESS_SPECIALIST',
  ] as const;

  const found = new Set(foundRoles);
  return recommended.filter((r) => !found.has(r));
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event)
  let executiveBriefId: string | undefined;

  try {
    const { executiveBriefId, force } = JSON.parse(event.body || '');

    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const inputHash = buildSectionInputHash({
      executiveBriefId,
      section: 'contacts',
      questionFileId: brief.questionFileId,
      textKey: brief.textKey,
    });

    const existing = (brief.sections as any)?.contacts;
    if (!force && existing?.status === 'COMPLETE' && existing?.inputHash === inputHash) {
      return apiResponse(200, {
        ok: true,
        executiveBriefId,
        section: 'contacts',
        status: existing.status,
        reused: true,
      });
    }

    await markSectionInProgress({
      executiveBriefId,
      section: 'contacts',
      inputHash,
    });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);

    const data = await invokeClaudeJson({
      modelId: BEDROCK_MODEL_ID,
      system: await useContactsSystemPrompt(orgId!),
      user: await useContactsUserPrompt(orgId!, solicitationText),
      outputSchema: ContactsSectionSchema,
      maxTokens: 1400,
      temperature: 0.1,
    });

    // Ensure missingRecommendedRoles present & correct
    const foundRoles = (data.contacts ?? []).map((c) => c.role);
    const normalized = {
      ...data,
      missingRecommendedRoles:
        data.missingRecommendedRoles?.length
          ? data.missingRecommendedRoles
          : (computeMissingRoles(foundRoles) as any),
    };

    await markSectionComplete({
      executiveBriefId,
      section: 'contacts',
      data: normalized,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });

    return apiResponse(200, {
      ok: true,
      executiveBriefId,
      section: 'contacts',
      status: 'COMPLETE',
    });
  } catch (err) {
    if (executiveBriefId) {
      try {
        await markSectionFailed({
          executiveBriefId,
          section: 'contacts',
          error: err,
        });
      } catch {
        // ignore
      }
    }

    console.error('generate-contacts error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
