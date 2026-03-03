import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { CloneTemplateDTOSchema } from '@auto-rfp/core';
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
import { getTemplate, loadTemplateHtml, putTemplate, uploadTemplateHtml } from '@/helpers/template';

const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const body = JSON.parse(event.body || '');
    const { success, data, error } = CloneTemplateDTOSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, { error: 'Validation failed', details: error.format() });
    }

    const orgId = data.orgId || getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const sourceOrgId = getOrgId(event) || event.queryStringParameters?.orgId || orgId;
    const source = await getTemplate(sourceOrgId, templateId);
    if (!source) return apiResponse(404, { error: 'Source template not found' });

    const userId = (event as any).auth?.userId || 'system';
    const newId = uuidv4();
    const now = nowIso();

    // Copy HTML content from source to new template in S3
    let htmlContentKey: string | null = null;
    if (source.htmlContentKey) {
      try {
        const sourceHtml = await loadTemplateHtml(source.htmlContentKey);
        htmlContentKey = await uploadTemplateHtml(orgId, newId, sourceHtml);
      } catch (err) {
        console.warn('Failed to copy template HTML during clone:', err);
      }
    }

    const cloned = {
      id: newId,
      orgId,
      name: data.newName,
      type: source.type ?? source.category ?? 'CUSTOM',
      category: source.category ?? source.type ?? 'CUSTOM',
      description: source.description ?? '',
      sections: [],
      macros: source.macros ?? [],
      styling: source.styling ?? undefined,
      htmlContentKey,
      tags: source.tags ?? [],
      isDefault: false,
      status: 'DRAFT' as const,
      currentVersion: 1,
      versions: [],
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      isArchived: false,
      archivedAt: null,
      usageCount: 0,
      lastUsedAt: null,
      usedInProjectIds: [],
      publishedAt: null,
      publishedBy: null,
      agencyId: data.agencyId ?? source.agencyId ?? undefined,
      agencyName: data.agencyName ?? source.agencyName ?? undefined,
    };

    await putTemplate(cloned);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'template',
      resourceId: newId,
    });

    return apiResponse(201, { data: cloned });
  } catch (err) {
    console.error('Error cloning template:', err);
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
    .use(requirePermission('template:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
