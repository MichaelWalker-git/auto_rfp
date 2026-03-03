import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { UpdateTemplateDTOSchema } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { nowIso } from '@/helpers/date';
import { getTemplate, putTemplate, uploadTemplateHtml } from '@/helpers/template';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const body = JSON.parse(event.body || '');
    const { success, data, error } = UpdateTemplateDTOSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, { error: 'Validation failed', details: error.format() });
    }

    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const userId = (event as any).auth?.userId || 'system';
    const now = nowIso();

    const existing = await getTemplate(orgId, templateId);
    if (!existing) return apiResponse(404, { error: 'Template not found' });
    if (existing.isArchived) return apiResponse(410, { error: 'Template is archived' });

    // Upload new HTML content to S3 if provided
    const htmlContentKey = data.htmlContent !== undefined
      ? await uploadTemplateHtml(orgId, templateId, data.htmlContent)
      : existing.htmlContentKey;

    const updated = {
      ...existing,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.tags !== undefined && { tags: data.tags }),
      ...(data.agencyId !== undefined && { agencyId: data.agencyId }),
      ...(data.agencyName !== undefined && { agencyName: data.agencyName }),
      ...(data.macros !== undefined && { macros: data.macros }),
      ...(data.styling !== undefined && { styling: data.styling }),
      htmlContentKey,
      sections: [],
      updatedAt: now,
      updatedBy: userId,
    };

    await putTemplate(updated);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'template',
      resourceId: templateId,
    });

    return apiResponse(200, { data: updated });
  } catch (err) {
    console.error('Error updating template:', err);
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
    .use(requirePermission('template:update'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
