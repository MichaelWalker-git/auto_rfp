import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { getRFPDocument, softDeleteRFPDocument } from '@/helpers/rfp-document';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });
    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    const body = event.body ? JSON.parse(event.body) : {};
    const projectId = body.projectId || event.queryStringParameters?.projectId;
    const opportunityId = body.opportunityId || event.queryStringParameters?.opportunityId;
    const documentId = body.documentId || event.queryStringParameters?.documentId;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const existing = await getRFPDocument(projectId, opportunityId, documentId);
    if (!existing || existing.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }
    if (existing.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied' });
    }

    await softDeleteRFPDocument({ projectId, opportunityId, documentId, deletedBy: userId });

    return apiResponse(200, { ok: true, message: 'Document deleted' });
  } catch (err) {
    console.error('Error in delete-rfp-document:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(middy(baseHandler));