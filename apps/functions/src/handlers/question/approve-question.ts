import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { ApproveQuestionDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { approveQuestion } from '@/helpers/question';
import { withSentryLambda } from '@/sentry-lambda';
import {
  AuthedEvent,
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

  const raw = JSON.parse(event.body);
  const { success, data, error } = ApproveQuestionDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation failed', issues: error.issues });

  const userId = event.auth?.userId;
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const claims = event.auth?.claims ?? {};
  const firstName = (claims['given_name'] as string | undefined) ?? '';
  const lastName = (claims['family_name'] as string | undefined) ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const displayName =
    fullName ||
    (claims['name'] as string | undefined) ||
    (claims['email'] as string | undefined) ||
    userId;

  const updated = await approveQuestion({
    orgId: data.orgId,
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    questionFileId: data.questionFileId,
    questionId: data.questionId,
    userId,
    userName: displayName,
  });

  if (!updated) return apiResponse(404, { message: 'Question not found' });

  return apiResponse(200, { question: updated });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:edit'))
    .use(httpErrorMiddleware()),
);
