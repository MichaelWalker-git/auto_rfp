import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import middy from '@middy/core';
import { CreateDocumentDTOSchema } from '@auto-rfp/core';

import { apiResponse, getUserId } from '@/helpers/api';
import { createDocument } from '@/helpers/document';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Runtime validation with Zod
    const { success, data, error: errors } = CreateDocumentDTOSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = errors.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const userId = getUserId(event) ?? 'system';
    const newDocument = await createDocument(data, userId);

    return apiResponse(201, newDocument);
  } catch (err) {
    console.error('Error in createDocument handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

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
    .use(requirePermission('document:create'))
    .use(httpErrorMiddleware())
);