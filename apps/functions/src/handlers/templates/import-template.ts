import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { ImportTemplateDTOSchema, SYSTEM_MACROS } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { nowIso } from '@/helpers/date';
import { putTemplate, saveTemplateVersion } from '@/helpers/template';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '');
    const parsed = ImportTemplateDTOSchema.safeParse(body);
    if (!parsed.success) {
      return apiResponse(400, { error: 'Validation failed', details: parsed.error.format() });
    }

    const { data } = parsed;
    const orgId = data.orgId || getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const userId = (event as any).auth?.userId || 'system';
    const templateId = uuidv4();
    const now = nowIso();
    const td = data.templateData;

    const allMacros = [...SYSTEM_MACROS, ...(td.macros ?? [])];

    const s3Key = await saveTemplateVersion(orgId, templateId, 1, {
      sections: td.sections,
      macros: allMacros,
      styling: td.styling,
    });

    const item = {
      id: templateId,
      orgId,
      name: td.name,
      type: td.type,
      category: td.category,
      description: td.description,
      sections: td.sections,
      macros: allMacros,
      styling: td.styling,
      tags: td.tags ?? [],
      isDefault: false,
      status: 'DRAFT' as const,
      currentVersion: 1,
      versions: [{
        version: 1,
        createdAt: now,
        createdBy: userId,
        changeNotes: 'Imported',
        s3ContentKey: s3Key,
        status: 'DRAFT' as const,
      }],
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
    .use(httpErrorMiddleware()),
);