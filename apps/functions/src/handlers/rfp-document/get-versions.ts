import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { listVersions } from '@/helpers/rfp-document-version';
import { getRFPDocument } from '@/helpers/rfp-document';
import { enrichWithUserNames } from '@/helpers/resolve-users';
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

  const { projectId, opportunityId, documentId } = event.queryStringParameters ?? {};
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!opportunityId) return apiResponse(400, { message: 'opportunityId is required' });
  if (!documentId) return apiResponse(400, { message: 'documentId is required' });

  // Verify document exists and belongs to org
  const doc = await getRFPDocument(projectId, opportunityId, documentId);
  if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
  if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

  const versions = await listVersions(projectId, opportunityId, documentId);

  // Enrich versions with user display names (resolves createdBy -> createdByName)
  const enrichedVersions = await enrichWithUserNames(orgId, versions);

  return apiResponse(200, { items: enrichedVersions, count: enrichedVersions.length });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
