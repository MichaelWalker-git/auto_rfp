import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import {
  ContactsSectionSchema,
  type ExecutiveBriefItem,
  ExecutiveBriefItemSchema,
  RoleSchema,
} from '@auto-rfp/shared';

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
    'You extract contact information from government solicitations.',
    'Return ONLY valid JSON matching the schema. No markdown, no code fences, no extra keys.',
    'Do not invent names/emails/phones.',
    'If role is unclear, use OTHER and include notes.',
    'Extract multiple contacts if present.',
  ].join('\n');
}

function buildUserPrompt(args: { solicitationText: string }): string {
  const { solicitationText } = args;

  return [
    'TASK: Build a contact directory for an Executive Opportunity Brief.',
    '',
    'You must extract contacts with differentiated roles, such as:',
    '- Contracting Officer',
    '- Contract Specialist',
    '- Technical POC',
    '- Program Manager',
    '- Small Business Specialist',
    '- Procurement POC',
    '- Subcontracting POC',
    '- General Inquiry',
    '',
    'OUTPUT JSON MUST match this schema:',
    '- contacts: array of { role, name?, title?, email?, phone?, organization?, notes?, evidence[] }',
    '- missingRecommendedRoles: array of role enums that were not found',
    '',
    'Allowed roles enum values:',
    JSON.stringify(RoleSchema.options, null, 2),
    '',
    'RULES:',
    '- If no email/phone is present, still include the contact name/title/role if available.',
    '- evidence[] should include SOLICITATION snippets around the contact line when possible.',
    'EVIDENCE FORMAT (IMPORTANT):',
    '- evidence must be an array of OBJECTS, not strings.',
    '- Each evidence item must be: { source: SOLICITATION, text: <>}',
    '- If you cannot provide evidence, set evidence to an empty array [].',
    '',
    'SOLICITATION TEXT:',
    solicitationText,
  ].join('\n');
}

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
  let executiveBriefId: string | undefined;

  try {
    const { executiveBriefId, force } = JSON.parse(event.body || '');

    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    ExecutiveBriefItemSchema.parse(brief);

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
      system: buildSystemPrompt(),
      user: buildUserPrompt({ solicitationText }),
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
