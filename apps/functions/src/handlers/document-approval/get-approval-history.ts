import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { listApprovalsByDocument } from '@/helpers/document-approval';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId, opportunityId, documentId } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!opportunityId) return apiResponse(400, { message: 'opportunityId is required' });
  if (!documentId) return apiResponse(400, { message: 'documentId is required' });

  const items = await listApprovalsByDocument(orgId, projectId, opportunityId, documentId);
  const activeApproval = items.find((a) => a.status === 'PENDING') ?? null;

  return apiResponse(200, { items, count: items.length, activeApproval });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
