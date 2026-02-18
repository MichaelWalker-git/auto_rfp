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
import { nowIso } from '@/helpers/date';
import { getTemplate, putTemplate, loadTemplateVersion, saveTemplateVersion } from '@/helpers/template';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
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

    const versionContent = await loadTemplateVersion(orgId, templateId, targetVersion);
    if (!versionContent) {
      return apiResponse(404, { error: `Version ${targetVersion} content not found in S3` });
    }

    const newVersion = existing.currentVersion + 1;
    const s3Key = await saveTemplateVersion(orgId, templateId, newVersion, versionContent);

    const versionMeta = {
      version: newVersion,
      createdAt: now,
      createdBy: userId,
      changeNotes: `Restored from version ${targetVersion}`,
      s3ContentKey: s3Key,
      status: 'DRAFT' as const,
    };

    const restored = {
      ...existing,
      sections: versionContent.sections,
      macros: (versionContent.macros ?? []) as any,
      styling: (versionContent.styling ?? undefined) as any,
      currentVersion: newVersion,
      versions: [...existing.versions, versionMeta],
      status: 'DRAFT' as const,
      updatedAt: now,
      updatedBy: userId,
    };

    await putTemplate(restored);
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
    .use(httpErrorMiddleware()),
);