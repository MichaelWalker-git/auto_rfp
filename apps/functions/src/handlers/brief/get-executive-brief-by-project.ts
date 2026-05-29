import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';

import { type ExecutiveBriefItem, } from '@auto-rfp/core';

import { getExecutiveBriefByProjectId, getExecutiveBriefsByProjectId } from '@/helpers/executive-opportunity-brief';

const RequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1).optional(), // Optional - if provided, get brief for specific opportunity
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const parsed = RequestSchema.parse(bodyJson);
    const projectId = event.pathParameters?.projectId ?? parsed.projectId;
    const opportunityId = event.pathParameters?.opportunityId ?? parsed.opportunityId;

    // If opportunityId is provided, get brief for that specific opportunity
    // Otherwise, get the latest brief for the project
    const brief: ExecutiveBriefItem = await getExecutiveBriefByProjectId(projectId, opportunityId);

    return apiResponse(200, {
      ok: true,
      projectId,
      opportunityId: brief.opportunityId || null,
      executiveBriefId: (brief as any).sort_key || (brief as any).id,
      brief,
    });
  } catch (err) {
    console.error('get-executive-brief-by-project error:', err);
    
    // Return 404 for "not found" errors, 500 for others
    const isNotFound = err instanceof Error && err.message.includes('not found');
    return apiResponse(isNotFound ? 404 : 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
