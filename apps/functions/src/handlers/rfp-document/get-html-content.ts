import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withSentryLambda } from '@/sentry-lambda';
import { getRFPDocument, loadRFPDocumentHtml } from '@/helpers/rfp-document';
import { apiResponse, getOrgId } from '@/helpers/api';
import { authContextMiddleware, httpErrorMiddleware } from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);
const s3Client = new S3Client({ region: REGION });

/**
 * Replace all `src="s3key:KEY"` placeholders in HTML with presigned S3 download URLs.
 * This is done server-side so the client receives ready-to-render HTML.
 */
async function resolveS3KeysInHtml(html: string): Promise<string> {
  if (!html) return html;

  // Find all s3key: placeholders
  const s3KeyRegex = /src="s3key:([^"]+)"/g;
  const keys: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = s3KeyRegex.exec(html)) !== null) {
    keys.push(match[1]);
  }
  if (!keys.length) return html;

  // Resolve all keys to presigned URLs in parallel
  const urlMap = new Map<string, string>();
  await Promise.all(keys.map(async (key) => {
    try {
      const url = await getSignedUrl(
        s3Client as Parameters<typeof getSignedUrl>[0],
        new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: key }),
        { expiresIn: PRESIGN_EXPIRES_IN },
      );
      urlMap.set(key, url);
    } catch (err) {
      console.warn(`Failed to generate presigned URL for image key: ${key}`, err);
    }
  }));

  // Replace s3key: placeholders with presigned URLs
  return html.replace(/src="s3key:([^"]+)"/g, (_, key) => {
    const url = urlMap.get(key);
    return url ? `src="${url}"` : `src=""`;
  });
}

/**
 * GET /rfp-document/html-content
 *
 * Returns the HTML content for a content-based RFP document.
 * HTML is loaded from S3 (htmlContentKey) when available,
 * with a fallback to the legacy inline content.content field in DynamoDB.
 *
 * Query params: projectId, opportunityId, documentId, orgId
 */
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const { projectId, opportunityId, documentId } = event.queryStringParameters ?? {};

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const doc = await getRFPDocument(projectId, opportunityId, documentId);
    if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
    if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

    let rawHtml = '';
    let htmlContentKey: string | null = null;

    if (doc.htmlContentKey && typeof doc.htmlContentKey === 'string') {
      // Primary path: load HTML from S3
      htmlContentKey = doc.htmlContentKey as string;
      rawHtml = await loadRFPDocumentHtml(htmlContentKey);
    } else if (doc.content && typeof doc.content === 'object') {
      // Fallback: legacy inline content stored in DynamoDB
      const c = doc.content as Record<string, unknown>;
      rawHtml = (c.content as string | undefined) ?? (c.htmlContent as string | undefined) ?? '';
    }

    // Always return 200 — even if empty, so the editor can render (empty doc is valid)
    // Replace s3key: placeholders with presigned URLs server-side
    const html = await resolveS3KeysInHtml(rawHtml);

    return apiResponse(200, {
      ok: true,
      html,
      htmlContentKey,
      documentId,
    });
  } catch (err) {
    console.error('Error in get-html-content:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware()),
);
