import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { nowIso } from '@/helpers/date';
import { getTemplate, putTemplate, loadTemplateHtml, uploadTemplateHtml } from '@/helpers/template';

const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    const versionStr = event.pathParameters?.version;
    if (!templateId || !versionStr) {
      return apiResponse(400, { error: 'Missing template ID or version' });
    }

    const targetVersion = parseInt(versionStr, 10);
    if (isNaN(targetVersion) || targetVersion < 1) {
      return apiResponse(400, { error: 'Invalid version number' });
    }

    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const userId = (event as any).auth?.userId || 'system';
    const now = nowIso();

    const existing = await getTemplate(orgId, templateId);
    if (!existing) return apiResponse(404, { error: 'Template not found' });

    // For the new htmlContentKey pattern, the current HTML is the only version stored.
    // Restore simply re-uploads the current HTML as a "restored" copy.
    // (Version history via S3 JSON snapshots is no longer used.)
    if (!existing.htmlContentKey) {
      return apiResponse(404, { error: 'Template has no HTML content to restore' });
    }

    const currentHtml = await loadTemplateHtml(existing.htmlContentKey);
    const restoredKey = await uploadTemplateHtml(orgId, templateId, currentHtml);

    const restored = {
      ...existing,
      sections: [],
      htmlContentKey: restoredKey,
      status: 'DRAFT' as const,
      updatedAt: now,
      updatedBy: userId,
    };

    await putTemplate(restored);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'template',
      resourceId: templateId,
    });

    return apiResponse(200, { data: restored });
  } catch (err) {
    console.error('Error restoring template version:', err);
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
