import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { transitionOpportunityStage } from '@/helpers/opportunity-stage';
import { UpdateOpportunityStageSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

/**
 * PATCH /opportunities/stage
 * Body: { projectId, oppId, stage, reason? }
 *
 * Manually transition an opportunity to a new pipeline stage.
 * Records the transition in stageHistory with source=MANUAL.
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const userId = getUserId(event) ?? 'system';

  const { success, data, error } = UpdateOpportunityStageSchema.safeParse(
    JSON.parse(event.body ?? '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const { projectId, oppId, stage, reason } = data;

  const updatedItem = await transitionOpportunityStage({
    orgId,
    projectId,
    oppId,
    toStage: stage,
    changedBy: userId,
    reason,
    source: 'MANUAL',
  });

  setAuditContext(event, {
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceId: oppId,
  });

  return apiResponse(200, {
    ok: true,
    oppId,
    stage: updatedItem.stage,
    item: updatedItem,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
