import type { APIGatewayProxyResultV2 } from 'aws-lambda';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { nowIso } from '@/helpers/date';
import { requireEnv } from '@/helpers/env';
import { onBriefGenerationStarted } from '@/helpers/opportunity-stage';
import {
  executiveBriefSKByOpportunity,
  getExecutiveBriefByProjectId,
  putExecutiveBrief,
} from '@/helpers/executive-opportunity-brief';
import { listQuestionFilesByOpportunity } from '@/helpers/questionFile';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { EXEC_BRIEF_PK } from '@/constants/exec-brief';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';

import {
  type ExecutiveBriefItem,
  ExecutiveBriefItemSchema,
  InitExecutiveBriefRequestSchema,
} from '@auto-rfp/core';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const buildEmptySection = () => {
  const now = nowIso();
  return { status: 'IDLE' as const, updatedAt: now };
};

const findExistingBrief = async (
  projectId: string,
  opportunityId: string,
): Promise<ExecutiveBriefItem | null> => {
  try {
    return await getExecutiveBriefByProjectId(projectId, opportunityId);
  } catch {
    // Brief doesn't exist yet — that's fine
    return null;
  }
};

export const initExecutiveBrief = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const bodyJson = event.body ? JSON.parse(event.body) : {};
  const { success, data, error } = InitExecutiveBriefRequestSchema.safeParse(bodyJson);

  if (!success) {
    return apiResponse(400, {
      ok: false,
      error: 'Validation failed',
      details: error.issues,
    });
  }

  const { projectId, opportunityId } = data;
  const orgId = getOrgId(event);

  // Load ALL question files for the opportunity
  const { items: questionFiles } = await listQuestionFilesByOpportunity({
    projectId,
    oppId: opportunityId,
  });

  // Filter to only processed files with textFileKey
  const processedFiles = questionFiles.filter(
    (qf) => qf.textFileKey && qf.status === 'PROCESSED',
  );

  if (processedFiles.length === 0) {
    return apiResponse(400, {
      ok: false,
      error:
        'No processed question files found for this opportunity. Please wait for text extraction to complete.',
      totalFiles: questionFiles.length,
      processedFiles: 0,
    });
  }

  // Sort by createdAt descending — most recent first
  const sortedFiles = processedFiles.sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || ''),
  );

  const sk = executiveBriefSKByOpportunity(projectId, opportunityId);
  const now = nowIso();

  const existingBrief = await findExistingBrief(projectId, opportunityId);
  const isRegeneration = !!existingBrief;

  const brief = {
    [PK_NAME]: EXEC_BRIEF_PK,
    [SK_NAME]: isRegeneration ? existingBrief[SK_NAME] : sk,
    projectId,
    orgId: orgId || null,
    opportunityId,
    textKey: sortedFiles[0]?.textFileKey,
    allTextKeys: sortedFiles.map((qf) => qf.textFileKey).filter(Boolean),
    documentsBucket: DOCUMENTS_BUCKET,
    status: 'IDLE' as const,
    sections: {
      summary: buildEmptySection(),
      deadlines: buildEmptySection(),
      requirements: buildEmptySection(),
      contacts: buildEmptySection(),
      risks: buildEmptySection(),
      pricing: buildEmptySection(),
      pastPerformance: buildEmptySection(),
      scoring: buildEmptySection(),
    },
    createdAt: isRegeneration ? existingBrief.createdAt ?? now : now,
    updatedAt: now,
  } satisfies Record<string, unknown>;

  // Validate against schema (throws on invalid data)
  const validatedBrief = ExecutiveBriefItemSchema.parse(brief) as ExecutiveBriefItem;
  await putExecutiveBrief(validatedBrief);

  // Auto-transition opportunity: IDENTIFIED → QUALIFYING (fire-and-forget)
  if (orgId && opportunityId) {
    onBriefGenerationStarted({ orgId, projectId, oppId: opportunityId });
  }

  const effectiveSk = isRegeneration
    ? String(existingBrief[SK_NAME] ?? sk)
    : sk;

  setAuditContext(event, {
    action: 'AI_GENERATION_STARTED',
    resource: 'pipeline',
    resourceId: effectiveSk,
  });

  return apiResponse(200, {
    ok: true,
    projectId,
    opportunityId,
    executiveBriefId: effectiveSk,
    textKey: sortedFiles[0]?.textFileKey,
    allTextKeys: sortedFiles.map((qf) => qf.textFileKey).filter(Boolean),
    totalQuestionFiles: questionFiles.length,
    processedQuestionFiles: processedFiles.length,
    regenerated: isRegeneration,
  });
};

export const handler = withSentryLambda(
  middy(initExecutiveBrief)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('brief:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);