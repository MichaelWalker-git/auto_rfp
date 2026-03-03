import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { saveCustomDocumentType } from '@/helpers/custom-document-types';

const BodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    const body = event.body ? JSON.parse(event.body) : {};
    const { success, data, error } = BodySchema.safeParse(body);
    if (!success) {
      return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
    }

    const item = await saveCustomDocumentType(orgId, data.name, data.description, false);

    return apiResponse(200, { ok: true, item });
  } catch (err) {
    console.error('save-custom-document-type error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
