/**
 * GET /rfp-document/kb-coverage?orgId=
 *
 * One org-scoped coverage report serving two consumers: the document-selection
 * dialog (which reads `byDocumentType` for the type the operator picked) and
 * the KB owner's aggregate gap view (which reads all of it).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { buildKBCoverageReport } from '@/helpers/kb-coverage';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    const report = await buildKBCoverageReport(orgId);

    return apiResponse(200, { ok: true, ...report });
  } catch (err) {
    console.error('get-kb-coverage error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);
