/**
 * POST /related-rfps/refresh
 *
 * Manual re-run of auto-discovery for an opportunity (HOR-2610). Fire-and-forget
 * invokes the find-related-rfps worker asynchronously (InvocationType: 'Event')
 * and returns 202 immediately — the client re-fetches the list to see results.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { RelatedRfpRefreshRequestSchema } from '@auto-rfp/core';

const lambdaClient = new LambdaClient({});
const getFindRelatedFunctionName = () => process.env.FIND_RELATED_RFPS_FUNCTION_NAME || '';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = RelatedRfpRefreshRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const { orgId, projectId, oppId } = data;

  const fnName = getFindRelatedFunctionName();
  if (!fnName) return apiResponse(500, { message: 'FIND_RELATED_RFPS_FUNCTION_NAME not configured' });

  await lambdaClient.send(new InvokeCommand({
    FunctionName: fnName,
    InvocationType: 'Event', // fire-and-forget
    Payload: Buffer.from(JSON.stringify({ orgId, projectId, oppId })),
  }));

  return apiResponse(202, { message: 'Related RFP discovery started' });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(httpErrorMiddleware()),
);
