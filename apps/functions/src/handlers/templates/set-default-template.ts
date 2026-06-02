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
import {
  clearDefaultForCategory,
  getTemplate,
  setDefaultTemplate,
} from '@/helpers/template';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const orgId = getOrgId(event) || event.queryStringParameters?.orgId;
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const existing = await getTemplate(orgId, templateId);
    if (!existing) return apiResponse(404, { error: 'Template not found' });

    const action = event.queryStringParameters?.action ?? 'set';

    // Unset: remove the default marker from this template
    if (action === 'unset') {
      await clearDefaultForCategory(orgId, existing.category, undefined);
      setAuditContext(event, { action: 'CONFIG_CHANGED', resource: 'template', resourceId: templateId });
      return apiResponse(200, {
        message: 'Default marker removed',
        templateId,
        isDefault: false,
      });
    }

    // Set: mark this template as the default template for its category
    if (existing.isArchived) return apiResponse(410, { error: 'Template is archived' });
    if (existing.status !== 'PUBLISHED') {
      return apiResponse(409, { error: 'Only a published template can be set as the default' });
    }

    await setDefaultTemplate(orgId, templateId, existing.category);

    setAuditContext(event, { action: 'CONFIG_CHANGED', resource: 'template', resourceId: templateId });
    return apiResponse(200, {
      message: 'Default template set',
      templateId,
      category: existing.category,
      isDefault: true,
      updatedAt: nowIso(),
    });
  } catch (err) {
    console.error('Error setting default template:', err);
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
    .use(requirePermission('template:set-default'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
