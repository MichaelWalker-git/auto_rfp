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
} from '@/middleware/rbac-middleware';
import { nowIso } from '@/helpers/date';
import { getTemplate, putTemplate, saveTemplateVersion } from '@/helpers/template';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const body = JSON.parse(event.body || '');
    const parsed = CloneTemplateDTOSchema.safeParse(body);
    if (!parsed.success) {
      return apiResponse(400, { error: 'Validation failed', details: parsed.error.format() });
    }

    const { data } = parsed;
    const orgId = data.orgId || getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const sourceOrgId = getOrgId(event) || event.queryStringParameters?.orgId || orgId;
    const source = await getTemplate(sourceOrgId, templateId);
    if (!source) return apiResponse(404, { error: 'Source template not found' });

    const userId = (event as any).auth?.userId || 'system';
    const newId = uuidv4();
    const now = nowIso();

    const s3Key = await saveTemplateVersion(orgId, newId, 1, {
      sections: source.sections ?? [],
      macros: source.macros ?? [],
      styling: source.styling ?? undefined,
    });

    // Build cloned item — avoid spreading source to prevent stale PK/SK
    const cloned = {
      id: newId,
      orgId,
      name: data.newName,
      type: source.type ?? source.category ?? 'CUSTOM',
      category: source.category ?? source.type ?? 'CUSTOM',
      description: source.description ?? '',
      sections: source.sections ?? [],
      macros: source.macros ?? [],
      styling: source.styling ?? undefined,
      tags: source.tags ?? [],
      isDefault: false,
      status: 'DRAFT' as const,
      currentVersion: 1,
      versions: [{
        version: 1,
        createdAt: now,
        createdBy: userId,
        changeNotes: `Cloned from "${source.name}" (${source.id})`,
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
      agencyId: data.agencyId ?? source.agencyId ?? undefined,
      agencyName: data.agencyName ?? source.agencyName ?? undefined,
    };

    await putTemplate(cloned);
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
    .use(httpErrorMiddleware()),
);