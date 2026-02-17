import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '../sentry-lambda';
import { getRFPDocument } from '../helpers/rfp-document';
import { enrichWithUserNames } from '../helpers/resolve-users';
import { apiResponse, getOrgId } from '../helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
} from '../middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const projectId = event.queryStringParameters?.projectId;
    const opportunityId = event.queryStringParameters?.opportunityId;
    const documentId = event.queryStringParameters?.documentId;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const document = await getRFPDocument(projectId, opportunityId, documentId);

    if (!document || document.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }

    if (document.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied' });
    }

    // Enrich with user display names
    await enrichWithUserNames(orgId, [document]);

    return apiResponse(200, { ok: true, document });
  } catch (err) {
    console.error('Error in get-rfp-document:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware()),
);
