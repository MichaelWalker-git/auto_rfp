import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { CreateTemplateDTOSchema, SYSTEM_MACROS } from '@auto-rfp/core';
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
import { putTemplate, uploadTemplateHtml } from '@/helpers/template';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '');
    const { success, data, error } = CreateTemplateDTOSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, { error: 'Validation failed', details: error.format() });
    }

    const orgId = data.orgId || getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const userId = (event as any).auth?.userId || 'system';
    const templateId = uuidv4();
    const now = nowIso();

    const allMacros = [...SYSTEM_MACROS, ...(data.macros ?? [])];

    // Upload HTML content to S3
    const htmlContentKey = data.htmlContent
      ? await uploadTemplateHtml(orgId, templateId, data.htmlContent)
      : null;

    const item = {
      id: templateId,
      orgId,
      name: data.name,
      type: data.type,
      category: data.category,
      description: data.description,
      sections: [],
      macros: allMacros,
      styling: data.styling,
      htmlContentKey,
      tags: data.tags ?? [],
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
      agencyId: data.agencyId,
      agencyName: data.agencyName,
    };

    await putTemplate(item);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'template',
      resourceId: templateId,
    });

    return apiResponse(201, { data: item });
  } catch (err) {
    console.error('Error creating template:', err);
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
