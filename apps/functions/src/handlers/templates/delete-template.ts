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
import { getTemplate, updateTemplateFields } from '@/helpers/template';
import { deleteItem } from '@/helpers/db';
import { deleteS3ObjectsFromKeys } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { createTemplateSK, TEMPLATE_PK } from '@auto-rfp/core';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const existing = await getTemplate(orgId, templateId);
    if (!existing) return apiResponse(404, { error: 'Template not found' });

    const action = event.queryStringParameters?.action;
    const now = nowIso();

    // Unarchive: restore archived template to DRAFT
    if (action === 'unarchive') {
      if (!existing.isArchived) return apiResponse(200, { message: 'Template is not archived' });
      await updateTemplateFields(orgId, templateId, { isArchived: false, archivedAt: null, status: 'DRAFT', updatedAt: now });
      setAuditContext(event, { action: 'CONFIG_CHANGED', resource: 'template', resourceId: templateId });
      return apiResponse(200, { message: 'Template restored', templateId, status: 'DRAFT' });
    }

    // Permanently delete: hard delete from DynamoDB + S3
    if (action === 'permanently-delete') {
      if (!existing.isArchived) return apiResponse(403, { error: 'Template must be archived before permanent deletion' });
      const s3Keys: unknown[] = [existing.htmlContentKey];
      if (existing.versions) {
        for (const v of existing.versions) { if (v.s3ContentKey) s3Keys.push(v.s3ContentKey); }
      }
      await deleteS3ObjectsFromKeys(DOCUMENTS_BUCKET, s3Keys).catch((err) => {
        console.warn('Failed to delete S3 objects:', templateId, err);
      });
      await deleteItem(TEMPLATE_PK, createTemplateSK(orgId, templateId));
      setAuditContext(event, { action: 'CONFIG_CHANGED', resource: 'template', resourceId: templateId });
      return apiResponse(200, { message: 'Template permanently deleted' });
    }

    // Default: Archive
    if (existing.isArchived) return apiResponse(200, { message: 'Template already archived' });
    await updateTemplateFields(orgId, templateId, { isArchived: true, archivedAt: now, status: 'ARCHIVED', updatedAt: now });
    setAuditContext(event, { action: 'CONFIG_CHANGED', resource: 'template', resourceId: templateId });
    return apiResponse(200, { message: 'Template archived' });
  } catch (err) {
    console.error('Error deleting template:', err);
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
    .use(requirePermission('template:delete'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
