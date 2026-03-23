import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { listClarifyingQuestionsByOpportunity } from '@/helpers/clarifying-question';
import { getOpportunity } from '@/helpers/opportunity';
import { loadAllSolicitationTexts } from '@/helpers/executive-opportunity-brief';
import { enqueueClarifyingQuestionGeneration } from '@/helpers/clarifying-question-queue';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const RequestBodySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  force: z.boolean().default(false),
  topK: z.number().int().min(1).max(20).default(10),
});

/**
 * POST /clarifying-question/generate
 *
 * Triggers async generation of clarifying questions for an opportunity.
 * Returns immediately with status "GENERATING" — the actual work is done
 * by the clarifying-question-worker Lambda via SQS.
 *
 * This avoids the API Gateway 29-second timeout for Claude invocations.
 */
const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(401, { ok: false, error: 'Unauthorized' });
  }

  // Parse body
  let body: unknown;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return apiResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const parseResult = RequestBodySchema.safeParse(body);
  if (!parseResult.success) {
    return apiResponse(400, {
      ok: false,
      error: 'Invalid request body',
      details: parseResult.error.flatten(),
    });
  }

  const { projectId, opportunityId, force, topK } = parseResult.data;

  // Get opportunity to verify it exists
  const opportunity = await getOpportunity({ orgId, projectId, oppId: opportunityId });
  if (!opportunity) {
    return apiResponse(404, { ok: false, error: 'Opportunity not found' });
  }

  // Check if questions already exist (unless force=true)
  if (!force) {
    const existing = await listClarifyingQuestionsByOpportunity({
      orgId,
      projectId,
      opportunityId,
      limit: 1,
    });

    if (existing.items.length > 0) {
      return apiResponse(200, {
        ok: true,
        status: 'EXISTS',
        message: 'Clarifying questions already exist. Use force=true to regenerate.',
        questionsGenerated: 0,
      });
    }
  }

  // Quick validation: check that solicitation documents exist
  const solicitationText = await loadAllSolicitationTexts(projectId, opportunityId);
  if (!solicitationText || solicitationText.trim().length < 100) {
    return apiResponse(400, {
      ok: false,
      error: 'No solicitation documents available',
      code: 'NO_DOCUMENTS',
      message: 'Please upload solicitation documents before generating clarifying questions. Documents must be fully processed.',
    });
  }

  // Get user info for audit trail
  const userId = (event as unknown as { auth?: { userId?: string } }).auth?.userId ?? 'system';
  const userName = (event as unknown as { auth?: { claims?: { name?: string } } }).auth?.claims?.name ?? 'system';

  // Enqueue the generation job
  await enqueueClarifyingQuestionGeneration({
    orgId,
    projectId,
    opportunityId,
    topK,
    force,
    userId,
    userName,
  });

  setAuditContext(event, {
    action: 'CLARIFYING_QUESTION_GENERATED',
    resource: 'clarifying-question',
    resourceId: opportunityId,
    orgId,
    changes: {
      after: {
        projectId,
        opportunityId,
        status: 'GENERATING',
        topK,
      },
    },
  });

  return apiResponse(202, {
    ok: true,
    status: 'GENERATING',
    message: 'Clarifying questions generation started. Poll GET /clarifying-question/list to check for results.',
    projectId,
    opportunityId,
  });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware()),
);
