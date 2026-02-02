import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { apiResponse } from '../helpers/api';

import { DeleteDocumentDTO, DeleteDocumentDTOSchema, } from '../schemas/document';
import { withSentryLambda } from '../sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import { deleteDocument } from '../helpers/document';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const json = JSON.parse(event.body || '');

    const { success, data, error } = DeleteDocumentDTOSchema.safeParse(json);
    if (!success) {
      const errors = error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors,
      });
    }

    const dto: DeleteDocumentDTO = data;

    await deleteDocument(dto);

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
    .use(httpErrorMiddleware())
);
