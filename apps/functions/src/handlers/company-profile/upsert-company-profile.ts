import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { CreateCompanyProfileDTOSchema } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { upsertCompanyProfile } from '@/helpers/company-profile';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const raw = event.body ? JSON.parse(event.body) : {};
  const { success, data, error } = CreateCompanyProfileDTOSchema.safeParse({ ...raw, orgId });

  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const profile = await upsertCompanyProfile({ orgId, dto: data });

  return apiResponse(200, { profile });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:edit'))
    .use(httpErrorMiddleware()),
);
