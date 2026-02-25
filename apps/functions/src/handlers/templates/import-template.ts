import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { z } from 'zod';
import { TemplateCategorySchema, SYSTEM_MACROS } from '@auto-rfp/core';
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
import { putTemplate, uploadTemplateHtml } from '@/helpers/template';

// Import DTO — accepts htmlContent for the new pattern
const ImportTemplateDTOSchema = z.object({
  orgId: z.string().uuid(),
  templateData: z.object({
    name: z.string().min(1).max(500),
    type: TemplateCategorySchema,
    category: TemplateCategorySchema,
    description: z.string().max(2000).optional(),
    htmlContent: z.string().max(10_000_000).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  }),
});

const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '');
    const { success, data, error } = ImportTemplateDTOSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, { error: 'Validation failed', details: error.format() });
    }

    const orgId = data.orgId || getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const userId = (event as any).auth?.userId || 'system';
    const templateId = uuidv4();
    const now = nowIso();
    const td = data.templateData;

    // Upload HTML content to S3
    const htmlContentKey = td.htmlContent
      ? await uploadTemplateHtml(orgId, templateId, td.htmlContent)
      : null;

    const item = {
      id: templateId,
      orgId,
      name: td.name,
      type: td.type,
      category: td.category,
      description: td.description,
      sections: [],
      macros: [...SYSTEM_MACROS],
      styling: undefined,
      htmlContentKey,
      tags: td.tags ?? [],
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
    };

    await putTemplate(item);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'template',
      resourceId: templateId,
    });

    return apiResponse(201, { data: item });
  } catch (err) {
    console.error('Error importing template:', err);
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
