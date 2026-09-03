import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import middy from '@middy/core';
import { z } from 'zod';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { requireEnv } from '@/helpers/env';
import { getExecutiveBriefByProjectId } from '@/helpers/executive-opportunity-brief';
import { BRIEF_DOCX_MIME, renderBriefDocxBuffer } from '@/helpers/brief-docx';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = 3600;

const s3Client = new S3Client({ region: REGION });

// ─── Request schema ───────────────────────────────────────────────────────────

const ExportBriefRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  projectName: z.string().optional(),
  opportunityName: z.string().optional(),
});

// ─── Lambda handler ───────────────────────────────────────────────────────────

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is required' });
  }

  try {
    const rawBody = JSON.parse(event.body);
    const { success, data, error } = ExportBriefRequestSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const { projectId, opportunityId, projectName, opportunityName } = data;
    const brief = await getExecutiveBriefByProjectId(projectId, opportunityId);

    // Use opportunity name (from request or brief summary title) as the document title
    const displayName = opportunityName
      || brief.sections.summary?.data?.title
      || projectName
      || 'Opportunity';

    const buffer = await renderBriefDocxBuffer(displayName, brief);

    const sanitizedName = displayName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 80);
    const key = `exports/${projectId}/${opportunityId}/${sanitizedName}_Executive_Brief.docx`;

    await s3Client.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: BRIEF_DOCX_MIME,
    }));

    const url = await getSignedUrl(s3Client as Parameters<typeof getSignedUrl>[0], new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
    }), { expiresIn: PRESIGN_EXPIRES_IN });

    setAuditContext(event, {
      action: 'DATA_EXPORTED',
      resource: 'config',
      resourceId: projectId,
    });

    return apiResponse(200, {
      success: true,
      export: { format: 'docx', url, expiresIn: PRESIGN_EXPIRES_IN, fileName: `${sanitizedName}_Executive_Brief.docx` },
    });
  } catch (err: unknown) {
    console.error('Error exporting executive brief:', err);
    return apiResponse(500, {
      message: 'Failed to export executive brief',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
