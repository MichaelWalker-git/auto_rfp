/**
 * PATCH /solution-plan/version/label
 *
 * Set, rename, or clear a version's label — the entity's ONLY mutable
 * attribute (contract C1). >100 chars → 400 via the schema, nothing executed
 * (BR2.1); absent/null/empty/whitespace → clear (BR2.2, the helper REMOVEs
 * the attribute); vanished version → 404 (BR2.4). Returns the updated list
 * item. Body: orgId, projectId, opportunityId, versionId, label?.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanVersionLabelRequestSchema } from '@auto-rfp/core';

import { apiResponse, parseJsonBody } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  setSolutionPlanVersionLabel,
  toSolutionPlanVersionListItem,
} from '@/helpers/solution-plan-version';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const setPlanVersionLabel = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SolutionPlanVersionLabelRequestSchema.safeParse(
    parseJsonBody(event),
  );
  if (!success) {
    // Covers the >100-char label (BR2.1). NEVER log the oversized value —
    // no oracle, per the u2 security design.
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const { versionId, label, ...key } = data;

  // One conditional single-attribute update (SET or REMOVE) inside the helper;
  // null → 404 (vanished version, nothing created). Storage errors propagate.
  const updated = await setSolutionPlanVersionLabel(key, versionId, label);
  if (!updated) {
    // Expected race — RETURNED, never thrown (NFR1.14); info log at the guard.
    console.info(
      JSON.stringify({
        event: 'solution_plan_version_label_not_found',
        ...key,
        versionId,
        outcome: 404,
      }),
    );
    return apiResponse(404, { message: 'Version not found' });
  }

  console.info(
    JSON.stringify({
      event: 'solution_plan_version_label_set',
      ...key,
      versionId,
      cleared: !label?.trim(),
      outcome: 200,
    }),
  );

  return apiResponse(200, { ok: true, version: toSolutionPlanVersionListItem(updated) });
};

export const handler = withSentryLambda(
  middy(setPlanVersionLabel)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware()),
);
