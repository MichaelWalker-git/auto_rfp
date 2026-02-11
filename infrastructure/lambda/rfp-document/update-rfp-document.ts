import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '../sentry-lambda';
import { getRFPDocument, updateRFPDocumentMetadata } from '../helpers/rfp-document';

const { apiResponse, getOrgId, getUserId } = require('../helpers/api');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });
    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

    const rawBody = JSON.parse(event.body);
    const projectId = rawBody.projectId || event.queryStringParameters?.projectId;
    const opportunityId = rawBody.opportunityId || event.queryStringParameters?.opportunityId;
    const documentId = rawBody.documentId || event.queryStringParameters?.documentId;

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

    const updates: Record<string, any> = {};
    if (rawBody.name !== undefined) updates.name = rawBody.name;
    if (rawBody.description !== undefined) updates.description = rawBody.description;
    if (rawBody.documentType !== undefined) updates.documentType = rawBody.documentType;

    const updated = await updateRFPDocumentMetadata({
      projectId,
      opportunityId,
      documentId,
      updates,
      updatedBy: userId,
    });

    return apiResponse(200, { ok: true, document: updated });
  } catch (err) {
    console.error('Error in update-rfp-document:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(middy(baseHandler));