import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { UpdateTemplateDTOSchema } from '@auto-rfp/shared';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { nowIso } from '../helpers/date';
import { getTemplate, putTemplate, saveTemplateVersion } from '../helpers/template';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const body = JSON.parse(event.body || '');
    const parsed = UpdateTemplateDTOSchema.safeParse(body);
    if (!parsed.success) {
      return apiResponse(400, { error: 'Validation failed', details: parsed.error.format() });
    }

    const { data } = parsed;
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const userId = (event as any).auth?.userId || 'system';
    const now = nowIso();

    const existing = await getTemplate(orgId, templateId);
    if (!existing) return apiResponse(404, { error: 'Template not found' });
    if (existing.isArchived) return apiResponse(410, { error: 'Template is archived' });

    const newVersion = existing.currentVersion + 1;
    const updatedSections = data.sections ?? existing.sections;
    const updatedMacros = data.macros ?? existing.macros;
    const updatedStyling = data.styling ?? existing.styling;

    const s3Key = await saveTemplateVersion(orgId, templateId, newVersion, {
      sections: updatedSections,
      macros: updatedMacros,
      styling: updatedStyling,
    });

    const versionMeta = {
      version: newVersion,
      createdAt: now,
      createdBy: userId,
      changeNotes: data.changeNotes ?? `Version ${newVersion}`,
      s3ContentKey: s3Key,
      status: 'DRAFT' as const,
    };

    const updated = {
      ...existing,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.tags !== undefined && { tags: data.tags }),
      ...(data.agencyId !== undefined && { agencyId: data.agencyId }),
      ...(data.agencyName !== undefined && { agencyName: data.agencyName }),
      sections: updatedSections,
      macros: updatedMacros,
      styling: updatedStyling,
      currentVersion: newVersion,
      versions: [...existing.versions, versionMeta],
      updatedAt: now,
      updatedBy: userId,
    };

    await putTemplate(updated);
    return apiResponse(200, { data: updated });
  } catch (err) {
    console.error('Error updating template:', err);
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
    .use(httpErrorMiddleware()),
);