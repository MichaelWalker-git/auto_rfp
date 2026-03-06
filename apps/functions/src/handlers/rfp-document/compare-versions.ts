import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getVersion, loadVersionHtml } from '@/helpers/rfp-document-version';
import { getRFPDocument } from '@/helpers/rfp-document';
import { CompareVersionsRequestSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { projectId, opportunityId, documentId, fromVersion, toVersion } = 
    event.queryStringParameters ?? {};

  const { success, data, error } = CompareVersionsRequestSchema.safeParse({
    documentId,
    projectId,
    opportunityId,
    fromVersion: fromVersion ? parseInt(fromVersion, 10) : undefined,
    toVersion: toVersion ? parseInt(toVersion, 10) : undefined,
  });

  if (!success) {
    return apiResponse(400, { message: 'Invalid request', issues: error.issues });
  }

  // Verify document exists and belongs to org
  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
  if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

  // Fetch both versions in parallel
  const [fromVer, toVer] = await Promise.all([
    getVersion(data.projectId, data.opportunityId, data.documentId, data.fromVersion),
    getVersion(data.projectId, data.opportunityId, data.documentId, data.toVersion),
  ]);

  if (!fromVer) return apiResponse(404, { message: `Version ${data.fromVersion} not found` });
  if (!toVer) return apiResponse(404, { message: `Version ${data.toVersion} not found` });

  // Load HTML content from S3 in parallel
  const [fromHtml, toHtml] = await Promise.all([
    loadVersionHtml(fromVer.htmlContentKey),
    loadVersionHtml(toVer.htmlContentKey),
  ]);

  return apiResponse(200, {
    fromVersion: fromVer,
    toVersion: toVer,
    fromHtml,
    toHtml,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
