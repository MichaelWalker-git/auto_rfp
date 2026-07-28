/**
 * POST /compliance-review/decision
 *
 * Records a user decision on a finding (dismiss / resolve), keyed by the
 * finding's stable fingerprint so it survives re-runs. A null state clears an
 * existing decision.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getUserId } from '@/helpers/api';
import { getOpportunity } from '@/helpers/opportunity';
import { clearFindingDecision, upsertFindingDecision } from '@/helpers/compliance-review';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { UpdateDecisionRequestSchema } from '@auto-rfp/core';

const QueryParamsSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
});

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const { success: qOk, data: query, error: qErr } = QueryParamsSchema.safeParse(event.queryStringParameters);
  if (!qOk) {
    return apiResponse(400, { message: 'Invalid query parameters', issues: qErr.issues });
  }
  const { orgId, projectId, opportunityId: oppId } = query;

  const { success, data, error } = UpdateDecisionRequestSchema.safeParse(JSON.parse(event.body || '{}'));
  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) return apiResponse(404, { message: 'Opportunity not found' });

  if (data.state === null) {
    await clearFindingDecision({ orgId, projectId, oppId, fingerprint: data.fingerprint });
    return apiResponse(200, { ok: true, decision: null });
  }

  const decision = await upsertFindingDecision({
    orgId,
    projectId,
    oppId,
    fingerprint: data.fingerprint,
    state: data.state,
    decidedBy: getUserId(event),
    decidedByName:
      (event.auth?.claims?.name as string | undefined) ??
      (event.auth?.claims?.email as string | undefined),
    note: data.note,
  });

  return apiResponse(200, { ok: true, decision });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);
