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

    // HTML content must be stored in S3
    if (!doc.htmlContentKey || typeof doc.htmlContentKey !== 'string') {
      // Check if the document is still generating
      if (doc.status === 'GENERATING') {
        return apiResponse(202, { message: 'Document is still being generated' });
      }
      // Check if the document generation failed
      if (doc.status === 'FAILED') {
        return apiResponse(422, {
          message: 'Document generation failed',
          generationError: doc.generationError ?? 'Unknown error',
        });
      }
      // Fallback: check for legacy inline HTML content in DynamoDB
      const legacyHtml = typeof doc.content === 'object' && doc.content !== null
        ? (doc.content as Record<string, unknown>).content
        : undefined;
      if (typeof legacyHtml === 'string' && legacyHtml.trim()) {
        console.warn(`Document ${documentId} has legacy inline HTML content (no S3 key). Serving from DynamoDB.`);
        const html = await resolveS3KeysInHtml(legacyHtml);
        return apiResponse(200, { ok: true, html, htmlContentKey: null, documentId });
      }
      return apiResponse(404, {
        message: 'HTML content not available (missing S3 key)',
        status: doc.status ?? 'UNKNOWN',
      });
    }

    const htmlContentKey = doc.htmlContentKey as string;
    const rawHtml = await loadRFPDocumentHtml(htmlContentKey);

    // Strip any leftover scaffold/generation comments that shouldn't be in the final HTML.
    // Strategy: strip all HTML comments that contain known scaffold markers.
    // Handle both closed comments (with -->) and unclosed comments (without -->).
    // Unclosed comments are especially dangerous — browsers treat everything after them as invisible.
    const sanitizedHtml = rawHtml
      // Closed comments (properly terminated with -->)
      .replace(/<!--\s*TEMPLATE SCAFFOLD:[\s\S]*?-->\s*/gi, '')
      .replace(/<!--\s*PRESERVE THIS IMAGE TAG EXACTLY AS-IS\s*-->\s*/gi, '')
      .replace(/<!--\s*Section guidance:[\s\S]*?-->\s*/gi, '')
      // Unclosed scaffold comments (no --> terminator) — strip from <!-- to end of line
      .replace(/<!--\s*TEMPLATE SCAFFOLD:[^\n]*\n?/gi, '')
      .replace(/<!--\s*PRESERVE THIS IMAGE TAG[^\n]*\n?/gi, '')
      .replace(/<!--\s*Section guidance:[^\n]*\n?/gi, '')
      .trim();

    // Always return 200 — even if empty, so the editor can render (empty doc is valid)
    // Replace s3key: placeholders with presigned URLs server-side
    const html = await resolveS3KeysInHtml(sanitizedHtml);

    return apiResponse(200, {
      ok: true,
      html,
      htmlContentKey,
      documentId,
    });
  } catch (err) {
    console.error('Error in get-html-content:', err);
    return apiResponse(500, { message: 'Internal server error' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware()),
);
