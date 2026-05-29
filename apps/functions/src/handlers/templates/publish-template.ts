import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { nowIso } from '@/helpers/date';
import { getTemplate, updateTemplateFields } from '@/helpers/template';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const orgId = getOrgId(event) || event.queryStringParameters?.orgId;
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const userId = (event as any).auth?.userId || 'system';
    const now = nowIso();

    const existing = await getTemplate(orgId, templateId);
    if (!existing) return apiResponse(404, { error: 'Template not found' });
    if (existing.isArchived) return apiResponse(410, { error: 'Template is archived' });

    await updateTemplateFields(orgId, templateId, {
      status: 'PUBLISHED',
      publishedAt: now,
      publishedBy: userId,
      updatedAt: now,
    });

    return apiResponse(200, {
      message: 'Template published',
      templateId,
      status: 'PUBLISHED',
      publishedAt: now,
    });
  } catch (err) {
    console.error('Error publishing template:', err);
    return apiResponse(500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('template:publish'))
    .use(httpErrorMiddleware()),
);