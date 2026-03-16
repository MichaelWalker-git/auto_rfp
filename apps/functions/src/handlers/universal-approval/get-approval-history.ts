import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getUniversalApprovalHistory } from '@/helpers/universal-approval';
import type { UniversalApprovalHistoryResponse, ApprovableEntityType } from '@auto-rfp/core';
import {
  authContextMiddleware, httpErrorMiddleware,
  orgMembershipMiddleware, requirePermission, type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { entityType, entitySK } = event.queryStringParameters ?? {};
  if (!entityType || !entitySK) {
    return apiResponse(400, { message: 'entityType and entitySK are required' });
  }

  // Validate entityType
  const validEntityTypes = [
    'rfp-document', 'brief', 'opportunity', 'submission', 
    'content-library', 'template', 'foia-request', 'debriefing-request'
  ];
  if (!validEntityTypes.includes(entityType)) {
    return apiResponse(400, { message: `Invalid entityType. Must be one of: ${validEntityTypes.join(', ')}` });
  }

  const history = await getUniversalApprovalHistory(orgId, entityType as ApprovableEntityType, entitySK);

  const response: UniversalApprovalHistoryResponse = {
    items: history.items,
    count: history.count,
    activeApproval: history.activeApproval,
  };

  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);