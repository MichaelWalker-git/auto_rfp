import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { FOIADocumentTypeSchema, type FOIAResponseDocument } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getUserId } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { getFoiaRequest, updateFoiaRequestFields } from '@/helpers/foia';

/**
 * Records a document the agency sent back in response to a FOIA request.
 *
 * A dedicated endpoint rather than widening `update-foia-request`'s
 * UPDATABLE_FIELDS: that allowlist guards the letter's content, and appending to
 * an array through a generic PATCH invites one client clobbering another's
 * upload with a stale copy of the list. This reads the current list and appends,
 * which is also where `responseReceivedAt` gets stamped.
 *
 * The file itself is uploaded directly to S3 by the browser via a presigned PUT;
 * this only records the metadata.
 */

const AddResponseDocumentSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  foiaRequestId: z.string().min(1),
  document: z.object({
    s3Key: z.string().min(1),
    fileName: z.string().min(1),
    contentType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
    /** Which requested document type this satisfies, when the user knows. */
    documentType: FOIADocumentTypeSchema.optional(),
  }),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = AddResponseDocumentSchema.safeParse(
    JSON.parse(event.body ?? '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const { orgId, projectId, oppId, foiaRequestId, document } = data;
  const userId = getUserId(event) ?? 'unknown';

  const existing = await getFoiaRequest(orgId, projectId, oppId, foiaRequestId);
  if (!existing) {
    return apiResponse(404, { message: 'FOIA request not found' });
  }

  // Guard against a double-submit re-recording the same object.
  const already = (existing.responseDocuments ?? []).some((d) => d.s3Key === document.s3Key);
  if (already) {
    return apiResponse(200, { ok: true, request: existing, alreadyRecorded: true });
  }

  const entry: FOIAResponseDocument = {
    ...document,
    uploadedAt: nowIso(),
    uploadedBy: userId,
  };

  const responseDocuments = [...(existing.responseDocuments ?? []), entry];

  const request = await updateFoiaRequestFields(orgId, projectId, oppId, foiaRequestId, {
    responseDocuments,
    // First document received is when the agency effectively responded.
    ...(existing.responseReceivedAt ? {} : { responseReceivedAt: entry.uploadedAt }),
  });

  setAuditContext(event, {
    action: 'DOCUMENT_UPLOADED',
    resource: 'foia_request',
    resourceId: foiaRequestId,
    orgId,
  });

  return apiResponse(201, { ok: true, request });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
