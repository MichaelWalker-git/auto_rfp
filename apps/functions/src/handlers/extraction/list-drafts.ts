import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { listDraftRecords, type DraftType } from '@/helpers/extraction';
import { 
  type PastProjectDraft, 
  type LaborRateDraft, 
  type BOMItemDraft,
  DraftTypeSchema,
} from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, status, limit, draftType } = event.queryStringParameters || {};

  if (!orgId) {
    return apiResponse(400, { ok: false, error: 'orgId is required' });
  }

  const parsedLimit = limit ? parseInt(limit, 10) : 50;
  
  // Validate draft type with Zod schema (default to PAST_PERFORMANCE if not provided)
  const draftTypeResult = DraftTypeSchema.safeParse(draftType || 'PAST_PERFORMANCE');
  if (!draftTypeResult.success) {
    return apiResponse(400, { ok: false, error: 'Invalid draftType' });
  }
  const type = draftTypeResult.data;

  const drafts = await listDraftRecords<PastProjectDraft | LaborRateDraft | BOMItemDraft>(
    type,
    orgId,
    status,
    parsedLimit
  );

  return apiResponse(200, { ok: true, drafts, count: drafts.length, draftType: type });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:read'))
    .use(httpErrorMiddleware()),
);
