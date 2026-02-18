import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';
import { getTemplate } from '@/helpers/template';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const template = await getTemplate(orgId, templateId);
    if (!template) return apiResponse(404, { error: 'Template not found' });

    const exportData = {
      name: template.name,
      type: template.type,
      category: template.category,
      description: template.description,
      sections: template.sections,
      macros: template.macros.filter(m => m.type === 'CUSTOM'),
      styling: template.styling,
      tags: template.tags,
      exportedAt: new Date().toISOString(),
      sourceTemplateId: template.id,
      sourceVersion: template.currentVersion,
    };

    return apiResponse(200, exportData);
  } catch (err) {
    console.error('Error exporting template:', err);
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
    .use(httpErrorMiddleware()),
);