import type { APIGatewayProxyResultV2 } from 'aws-lambda';
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
import { deleteItem } from '@/helpers/db';
import { deleteS3ObjectsFromKeys } from '@/helpers/s3';
import { getTemplate } from '@/helpers/template';
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
    if (!existing.isArchived) {
      return apiResponse(403, { error: 'Template must be archived before permanent deletion' });
    }

    // Collect S3 keys to clean up
    const s3Keys: unknown[] = [existing.htmlContentKey];
    if (existing.versions) {
      for (const v of existing.versions) {
        if (v.s3ContentKey) s3Keys.push(v.s3ContentKey);
      }
    }

    // Delete S3 content (best-effort)
    await deleteS3ObjectsFromKeys(DOCUMENTS_BUCKET, s3Keys).catch((err) => {
      console.warn('Failed to delete some S3 objects for template:', templateId, err);
    });

    // Delete DynamoDB item
    await deleteItem(TEMPLATE_PK, createTemplateSK(orgId, templateId));

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'template',
      resourceId: templateId,
    });

    return apiResponse(200, { message: 'Template permanently deleted' });
  } catch (err) {
    console.error('Error permanently deleting template:', err);
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
