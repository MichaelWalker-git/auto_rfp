import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { type ExecutiveBriefItem, } from '@auto-rfp/shared';

import { getExecutiveBriefByProjectId } from '../helpers/executive-opportunity-brief';

const RequestSchema = z.object({
  projectId: z.string().min(1),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const projectId = event.pathParameters?.projectId ?? RequestSchema.parse(bodyJson).projectId;

    const brief: ExecutiveBriefItem = await getExecutiveBriefByProjectId(projectId);

    return apiResponse(200, {
      ok: true,
      projectId,
      executiveBriefId: brief.id,
      brief,
    });
  } catch (err) {
    console.error('get-executive-brief-by-project error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
