import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { apiResponse } from '@/helpers/api';

import { DeleteDocumentDTO, DeleteDocumentDTOSchema, } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { deleteDocument } from '@/helpers/document';

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const json = JSON.parse(event.body || '');

    const { success, data, error: errors } = DeleteDocumentDTOSchema.safeParse(json);
    if (!success) {
      const errorDetails = errors.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const dto: DeleteDocumentDTO = data;

    await deleteDocument(dto);

    
    setAuditContext(event, {
      action: 'DOCUMENT_DELETED',
      resource: 'document',
      resourceId: dto.id,
    });

    return apiResponse(200, {
      success: true,
      id: dto.id,
      knowledgeBaseId: dto.knowledgeBaseId,
    });
  } catch (err) {
    console.error('Error in delete-document handler:', err);

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
    .use(requirePermission('document:delete'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
