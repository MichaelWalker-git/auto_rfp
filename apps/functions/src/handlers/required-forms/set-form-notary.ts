import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { NotaryStatusSchema } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, parseJsonBody } from '@/helpers/api';
import {
  getRequiredForm,
  updateRequiredForm,
  listRequiredFormsByOpportunity,
} from '@/helpers/required-form';
import { rollupOpportunityNotary } from '@/helpers/notary-wiring';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const BodySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  formId: z.string().min(1),
  notaryStatus: NotaryStatusSchema,
});

/**
 * Manual notary override (FR7.2 / BR12.1): set a form's notary classification
 * by hand. The patch stamps `notarySource: 'USER_SET'`, which flips the atomic
 * guard on every AI write path (per-form persist, rollup, unmapped triggers) —
 * detection re-runs will never overwrite this form's classification again.
 *
 * The detected `notaryRequirements` evidence is intentionally KEPT: for a
 * user-set flagged status the trigger detail stays reviewable, and for a
 * user-set NOT_REQUIRED it remains the audit trail of what was dismissed.
 *
 * After the write, the opportunity rollup is recomputed (best-effort) so the
 * card chip reflects the change immediately — with the notification SUPPRESSED
 * (the user just made this change themselves; notifying about it is noise).
 */
export const setFormNotary = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const parsedBody = parseJsonBody(event);
  if (parsedBody === undefined) return apiResponse(400, { message: 'Invalid JSON body' });
  const { success, data, error } = BodySchema.safeParse(parsedBody);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const { projectId, opportunityId, formId, notaryStatus } = data;

  const form = await getRequiredForm({ orgId, projectId, opportunityId, formId });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  const updated = await updateRequiredForm({
    orgId,
    projectId,
    opportunityId,
    formId,
    patch: { notaryStatus, notarySource: 'USER_SET' },
  });

  // Recompute the opportunity summary from the new per-form state so the card
  // chip updates immediately. Best-effort (the helper never throws) and
  // notification-suppressed — this is the user's own edit, not a detection.
  try {
    const forms = await listRequiredFormsByOpportunity({ orgId, projectId, opportunityId });
    await rollupOpportunityNotary({ orgId, projectId, oppId: opportunityId, forms, notify: false });
  } catch (err) {
    console.warn(
      `[set-form-notary] rollup recompute failed for ${opportunityId} (form updated fine):`,
      (err as Error)?.message,
    );
  }

  return apiResponse(200, {
    formId,
    notaryStatus: updated.notaryStatus,
    notarySource: updated.notarySource,
  });
};

export const handler = withSentryLambda(
  middy(setFormNotary)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('form:edit'))
    .use(httpErrorMiddleware()),
);
