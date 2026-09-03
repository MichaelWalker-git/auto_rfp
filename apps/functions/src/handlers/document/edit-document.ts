import { APIGatewayProxyResultV2, } from 'aws-lambda';

import { apiResponse } from '@/helpers/api';

import { UpdateDocumentDTO, UpdateDocumentDTOSchema, } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';
import { DocumentNotFoundError, DuplicateDocumentNameError, updateDocument } from '@/helpers/document';

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is missing' });
    }

    let json: any;
    try {
      json = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    // Validate input with Zod
    const parsed = UpdateDocumentDTOSchema.safeParse(json);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors,
      });
    }

    const dto: UpdateDocumentDTO = parsed.data;

    // Set upfront (best-guess action from intent) so a failure below is still
    // audited — the `after`/`onError` audit-middleware hooks only log when
    // `_auditCtx` has been set on the event.
    setAuditContext(event, {
      action: dto.name !== undefined ? 'DOCUMENT_RENAMED' : 'DOCUMENT_UPDATED',
      resource: 'document',
      resourceId: dto.id,
    });

    let result;
    try {
      result = await updateDocument(dto);
    } catch (err) {
      if (err instanceof DuplicateDocumentNameError) {
        return apiResponse(409, { message: err.message });
      }
      if (err instanceof DocumentNotFoundError) {
        return apiResponse(404, { message: err.message });
      }
      throw err;
    }

    // Refine the action now that we know whether the name actually changed.
    setAuditContext(event, {
      action: result.hasNameChanged ? 'DOCUMENT_RENAMED' : 'DOCUMENT_UPDATED',
      resource: 'document',
      resourceId: dto.id,
    });

    return apiResponse(200, result.document);
  } catch (err) {
    console.error('Error in edit-document handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
