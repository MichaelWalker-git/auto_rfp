/**
 * POST /required-forms/revert-version
 *
 * Reverts a required form to a prior version's fields. Snapshots the current
 * fields first (source SYSTEM) so the revert is itself undoable. Permission:
 * document:edit (matches the form-field write handlers).
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId, parseJsonBody } from '@/helpers/api';
import { revertFormToVersion } from '@/helpers/required-form-version';
import { isNotFoundError } from '@/helpers/error';
import { writePackageEditAuditLog } from '@/helpers/package-edit-audit';

import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { RevertFormVersionRequestSchema } from '@auto-rfp/core';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const parsedBody = parseJsonBody(event);
  if (parsedBody === undefined) return apiResponse(400, { message: 'Invalid JSON body' });
  const { success, data, error } = RevertFormVersionRequestSchema.safeParse(parsedBody);
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const userId = getUserId(event) ?? 'system';
  const userName =
    (event.auth?.claims?.name as string | undefined) ??
    (event.auth?.claims?.email as string | undefined) ??
    'system';

  try {
    const { form, snapshotVersionNumber } = await revertFormToVersion({
      orgId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      formId: data.formId,
      targetVersion: data.targetVersion,
      userId,
      userName,
      changeNote: data.changeNote,
    });

    await writePackageEditAuditLog({
      action: 'FORM_VERSION_REVERTED',
      resource: 'required_form',
      resourceId: data.formId,
      orgId,
      userId,
      userName,
      after: {
        opportunityId: data.opportunityId,
        targetVersion: data.targetVersion,
        preRevertSnapshotVersion: snapshotVersionNumber,
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
    });

    return apiResponse(200, { form });
  } catch (err) {
    // Missing form / version → 404, classified by TYPE so a reworded message can't
    // downgrade it to a 500. Anything else bubbles to the error middleware.
    if (isNotFoundError(err)) return apiResponse(404, { message: err.message });
    throw err;
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
