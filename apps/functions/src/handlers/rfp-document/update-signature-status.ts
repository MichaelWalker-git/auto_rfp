import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '../../sentry-lambda';
import { getRFPDocument, updateRFPDocumentSignatureStatus } from '@/helpers/rfp-document';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });
    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

    const body = JSON.parse(event.body);
    const { projectId, opportunityId, documentId, signatureStatus, signatureDetails } = body;

    if (!projectId || !opportunityId || !documentId || !signatureStatus) {
      return apiResponse(400, { message: 'projectId, opportunityId, documentId, and signatureStatus are required' });
    }

    const existing = await getRFPDocument(projectId, opportunityId, documentId);
    if (!existing || existing.deletedAt) return apiResponse(404, { message: 'Document not found' });
    if (existing.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

    const updated = await updateRFPDocumentSignatureStatus({ projectId, opportunityId, documentId, signatureStatus, signatureDetails, updatedBy: userId });

    return apiResponse(200, { ok: true, document: updated });
  } catch (err) {
    console.error('Error in update-signature-status:', err);
    return apiResponse(500, { message: 'Internal server error', error: err instanceof Error ? err.message : 'Unknown error' });
  }
};

export const handler = withSentryLambda(middy(baseHandler));