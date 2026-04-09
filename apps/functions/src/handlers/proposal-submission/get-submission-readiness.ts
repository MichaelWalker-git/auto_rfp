import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { checkSubmissionReadiness } from '@/helpers/proposal-submission';
import { getOpportunity } from '@/helpers/opportunity';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId, oppId } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!oppId) return apiResponse(400, { message: 'oppId is required' });

  const opp = await getOpportunity({ orgId, projectId, oppId });
  const deadlineIso = (opp?.item?.responseDeadlineIso as string | undefined) ?? null;
  const currentStage = (opp?.item?.stage as string | undefined) ?? null;
  const ignoredCheckIds = (opp?.item?.ignoredComplianceCheckIds as string[] | undefined) ?? [];

  const readiness = await checkSubmissionReadiness({ orgId, projectId, oppId, deadlineIso, currentStage, ignoredCheckIds });
  return apiResponse(200, readiness);
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
