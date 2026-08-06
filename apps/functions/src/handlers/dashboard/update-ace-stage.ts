import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

import { setAceStageLocal, syncAceStageToPartnerCentral } from '@/helpers/ace-stage';
import { UpdateAceStageSchema } from '@auto-rfp/core';
import type { AceStage } from '@auto-rfp/core';

/**
 * POST /dashboard/update-ace-stage
 *
 * Manually set an opportunity's ACE (AWS Partner Central) lifecycle stage from
 * the board dropdown. All 7 stages are freely selectable. The local write
 * commits first; the push to Partner Central is best-effort (a PC failure is
 * recorded as apnSyncError and surfaced via aceSynced=false, never a request
 * failure). If the opportunity has no Partner Central record yet, the sync
 * creates one.
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { success, data, error } = UpdateAceStageSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: error.issues,
      });
    }

    const orgId = data.orgId ?? getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { ok: false, error: 'orgId is required' });
    }

    const { projectId, oppId, aceStage } = data;
    const userId = getUserId(event);

    let item;
    try {
      item = await setAceStageLocal({
        orgId,
        projectId,
        oppId,
        to: aceStage,
        changedBy: userId ?? 'system',
        source: 'MANUAL',
      });
    } catch (stageErr: unknown) {
      if (stageErr instanceof Error && stageErr.message.startsWith('Opportunity not found')) {
        return apiResponse(404, { ok: false, error: 'Opportunity not found' });
      }
      throw stageErr;
    }

    const fromStage = (item.aceStageHistory?.[item.aceStageHistory.length - 1]?.from ?? null) as
      | AceStage
      | null;

    setAuditContext(event, {
      action: 'OPPORTUNITY_ACE_STAGE_CHANGED',
      resource: 'opportunity',
      resourceId: oppId,
      orgId,
      changes: {
        before: { aceStage: fromStage },
        after: { aceStage },
      },
    });

    // Push to Partner Central — best-effort, local value is already committed.
    const aceSynced = await syncAceStageToPartnerCentral({
      orgId,
      projectId,
      oppId,
      item,
      aceStage,
    });

    return apiResponse(200, { ok: true, oppId, item, aceSynced });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { ok: false, error: 'Opportunity not found' });
    }
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal Server Error',
    });
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(auditMiddleware())
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit')),
);
