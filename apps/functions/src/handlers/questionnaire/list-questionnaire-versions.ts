/**
 * GET /questionnaire/versions
 *
 * Lists the version history (newest first) of one file-based XLSX questionnaire.
 * Feeds the questionnaire version-history UI. Permission: document:read (matches
 * the RFP-document read handlers). Mirrors list-form-versions.ts.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { listQuestionnaireVersions } from '@/helpers/questionnaire-version';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { QuestionnaireVersionListResponseSchema } from '@auto-rfp/core';

const QuerySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
});

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { success, data, error } = QuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!success) return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });

  const versions = await listQuestionnaireVersions(
    orgId,
    data.projectId,
    data.opportunityId,
    data.documentId,
  );

  return apiResponse(
    200,
    QuestionnaireVersionListResponseSchema.parse({ versions, count: versions.length }),
  );
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
