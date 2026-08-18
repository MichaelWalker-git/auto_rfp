import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { ClassifyDisclosureRequestSchema } from '@auto-rfp/core';
import { classifyDisclosure } from '@/helpers/disclosure-classifier';
import { saveDisclosureProposal } from '@/helpers/past-performance';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  let raw: unknown;
  try {
    raw = JSON.parse(event.body || '{}');
  } catch {
    return apiResponse(400, { message: 'Invalid JSON in request body' });
  }

  const { success, data, error } = ClassifyDisclosureRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const { proposals, classified, failed } = await classifyDisclosure(
    data.orgId,
    data.projectIds,
    data.force,
  );

  // Persist proposals only — never the effective disclosure / confirmation.
  // Use allSettled so one write failure (transient DynamoDB error) can't discard
  // the other valid proposals in this response. Rows whose projectId no longer
  // exists are already skipped inside saveDisclosureProposal (returns false).
  const persisted = await Promise.allSettled(
    proposals.map((p) => saveDisclosureProposal(data.orgId, p)),
  );
  const persistFailed = proposals
    .filter((_, i) => {
      const outcome = persisted[i];
      return outcome.status === 'rejected' || outcome.value === false;
    })
    .map((p) => p.projectId);
  if (persistFailed.length) {
    console.warn(`classify-disclosure: ${persistFailed.length} proposal(s) not persisted: ${persistFailed.join(', ')}`);
  }

  // Fold persist failures into `failed` so the client sees the true outcome.
  const allFailed = [...failed, ...persistFailed];
  return apiResponse(200, { proposals, classified: classified - persistFailed.length, failed: allFailed });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:edit'))
    .use(httpErrorMiddleware()),
);
