/**
 * POST /questionnaire/revert-version
 *
 * Reverts a file-based XLSX questionnaire to a prior version's file. Snapshots
 * the current file first (source SYSTEM) so the revert is itself undoable.
 * Permission: document:edit (matches the form-version revert + document write
 * handlers). Mirrors revert-form-version.ts.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId, parseJsonBody } from '@/helpers/api';
import { revertQuestionnaireToVersion } from '@/helpers/questionnaire-version';
import { isNotFoundError } from '@/helpers/error';
import { writePackageEditAuditLog } from '@/helpers/package-edit-audit';

import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { RevertQuestionnaireVersionRequestSchema } from '@auto-rfp/core';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const parsedBody = parseJsonBody(event);
  if (parsedBody === undefined) return apiResponse(400, { message: 'Invalid JSON body' });
  const { success, data, error } = RevertQuestionnaireVersionRequestSchema.safeParse(parsedBody);
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const userId = getUserId(event) ?? 'system';
  const userName =
    (event.auth?.claims?.name as string | undefined) ??
    (event.auth?.claims?.email as string | undefined) ??
    'system';

  try {
    const { snapshotVersionNumber } = await revertQuestionnaireToVersion({
      orgId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      documentId: data.documentId,
      targetVersion: data.targetVersion,
      userId,
      userName,
      changeNote: data.changeNote,
    });

    await writePackageEditAuditLog({
      action: 'QUESTIONNAIRE_VERSION_REVERTED',
      resource: 'rfp_document',
      resourceId: data.documentId,
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

    return apiResponse(200, { documentId: data.documentId, snapshotVersionNumber });
  } catch (err) {
    // Classify by TYPE, not message text — a reworded message must not flip a 404
    // into a 500. Anything that isn't a NotFoundError bubbles to the middleware.
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
