/**
 * GET /solution-plan/version/content
 *
 * Serve one version's HTML body plus its list-item metadata (contract C1).
 * The record is located first (miss → 404, an expected race per BR1.3); the
 * body is then fetched at the RECORD's own `htmlContentKey` — the S3 key is
 * never taken from, or influenced by, client input (content isolation,
 * NFR3.8). Query params: orgId, projectId, opportunityId, versionId.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanVersionContentRequestSchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { loadSolutionPlanHtml } from '@/helpers/solution-plan';
import {
  getSolutionPlanVersion,
  toSolutionPlanVersionListItem,
} from '@/helpers/solution-plan-version';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const getPlanVersionContent = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SolutionPlanVersionContentRequestSchema.safeParse(
    event.queryStringParameters ?? {},
  );
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const { versionId, ...key } = data;

  const version = await getSolutionPlanVersion(key, versionId);
  if (!version) {
    // Expected race (deleted/pruned meanwhile) — RETURNED, never thrown, so
    // Sentry structurally cannot see it (NFR1.14); info log at the guard site.
    console.info(
      JSON.stringify({
        event: 'solution_plan_version_content_not_found',
        ...key,
        versionId,
        outcome: 404,
      }),
    );
    return apiResponse(404, { message: 'Version not found' });
  }

  // Body fetch at the located record's OWN key. A storage failure here is NOT
  // caught — it propagates and withSentryLambda reports it (NFR1.15).
  const html = await loadSolutionPlanHtml(version.htmlContentKey);

  console.info(
    JSON.stringify({
      event: 'solution_plan_version_content_served',
      ...key,
      versionId,
      outcome: 200,
    }),
  );

  return apiResponse(200, { ok: true, html, version: toSolutionPlanVersionListItem(version) });
};

export const handler = withSentryLambda(
  middy(getPlanVersionContent)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
