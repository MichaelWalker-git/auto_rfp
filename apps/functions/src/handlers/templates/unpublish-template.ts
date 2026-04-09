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
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
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

    const existing = await getTemplate(orgId, templateId);
    if (!existing) return apiResponse(404, { error: 'Template not found' });
    if (existing.isArchived) return apiResponse(410, { error: 'Template is archived' });
    if (existing.status !== 'PUBLISHED') return apiResponse(409, { error: 'Template is not published' });

    const now = nowIso();
    await updateTemplateFields(orgId, templateId, {
      status: 'DRAFT',
      publishedAt: null,
      publishedBy: null,
      updatedAt: now,
    });

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'template',
      resourceId: templateId,
    });

    return apiResponse(200, {
      message: 'Template unpublished',
      templateId,
      status: 'DRAFT',
    });
  } catch (err) {
    console.error('Error unpublishing template:', err);
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
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
