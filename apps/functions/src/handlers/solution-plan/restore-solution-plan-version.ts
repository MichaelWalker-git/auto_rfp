/**
 * POST /solution-plan/version/restore
 *
 * Restore-as-new (contract C2, solution-plan-versioning u3): make the selected
 * version's content the new current plan state. The W1 pipeline (copy →
 * conditional write → capture) lives in `@/helpers/solution-plan-restore` —
 * this handler validates the body, derives the restorer server-side (NFR3.12 —
 * attribution NEVER comes from the request), and maps the typed outcomes:
 * SOURCE_NOT_FOUND → 404, CURRENT_VERSION / GENERATING → 409 (distinct codes),
 * RESTORED → 200 { ok, newVersion } (null when capture failed fail-open).
 * Guard rejections are RETURNED with INFO logs — never thrown, never Sentry
 * (NFR1.22); unexpected errors propagate to withSentryLambda.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanVersionRestoreRequestSchema } from '@auto-rfp/core';

import { apiResponse, getUserId, parseJsonBody } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { restoreSolutionPlanVersion } from '@/helpers/solution-plan-restore';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const restorePlanVersion = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SolutionPlanVersionRestoreRequestSchema.safeParse(
    parseJsonBody(event),
  );
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const { versionId, ...key } = data;

  // Server-derived attribution (NFR3.12) — the system sentinel is NEVER used
  // on this path: restore is always human-initiated.
  const restoredBy = getUserId(event);
  if (!restoredBy) {
    return apiResponse(401, { message: 'Unauthorized' });
  }
  const restoredByName =
    (event.auth?.claims?.name as string | undefined) ??
    (event.auth?.claims?.email as string | undefined);

  const result = await restoreSolutionPlanVersion({
    key,
    versionId,
    restoredBy,
    restoredByName,
    requestId: event.requestContext?.requestId,
  });

  // Guard outcomes are expected behavior — RETURNED with machine-readable
  // INFO logs carrying the plan key + versionId (NFR1.22), never Sentry.
  if (result.outcome === 'SOURCE_NOT_FOUND') {
    console.info(
      JSON.stringify({
        event: 'solution_plan_restore_rejected',
        reason: 'SOURCE_NOT_FOUND',
        ...key,
        versionId,
        outcome: 404,
      }),
    );
    return apiResponse(404, { message: 'Source version not found' });
  }

  if (result.outcome === 'CURRENT_VERSION') {
    console.info(
      JSON.stringify({
        event: 'solution_plan_restore_rejected',
        reason: 'CURRENT_VERSION',
        ...key,
        versionId,
        outcome: 409,
      }),
    );
    return apiResponse(409, {
      message: 'The current version cannot be restored.',
      code: 'SOLUTION_PLAN_VERSION_CURRENT',
    });
  }

  if (result.outcome === 'GENERATING') {
    console.info(
      JSON.stringify({
        event: 'solution_plan_restore_rejected',
        reason: 'GENERATING',
        ...key,
        versionId,
        outcome: 409,
      }),
    );
    return apiResponse(409, {
      message: 'The plan is being generated — restore is unavailable until it finishes.',
      code: 'SOLUTION_PLAN_GENERATING',
    });
  }

  return apiResponse(200, { ok: true, newVersion: result.newVersion });
};

export const handler = withSentryLambda(
  middy(restorePlanVersion)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware()),
);
