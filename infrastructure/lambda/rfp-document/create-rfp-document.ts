import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withSentryLambda } from '../sentry-lambda';
import { putRFPDocument, buildRFPDocumentS3Key } from '../helpers/rfp-document';
import { apiResponse, getOrgId, getUserId } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { requireEnv } from '../helpers/env';
import { RFP_DOCUMENT_PK } from '../constants/rfp-document';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const s3Client = new S3Client({});

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
  'image/png',
  'image/jpeg',
  'image/gif',
  'text/plain',
  'text/markdown',
]);

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Content-based document types that don't require file upload (e.g., PROPOSAL).
 * These documents store structured content in DynamoDB directly.
 */
const CONTENT_BASED_DOCUMENT_TYPES = new Set(['TECHNICAL_PROPOSAL']);

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

    const data = JSON.parse(event.body);

    if (!data.projectId || !data.opportunityId || !data.name) {
      return apiResponse(400, { message: 'projectId, opportunityId, and name are required' });
    }

    const documentType = data.documentType ?? 'OTHER';
    const isContentBased = CONTENT_BASED_DOCUMENT_TYPES.has(documentType);

    // For content-based documents (e.g., PROPOSAL), mimeType and file upload are not required
    if (!isContentBased) {
      if (!data.mimeType) {
        return apiResponse(400, { message: 'mimeType is required for file-based documents' });
      }
      if (!ALLOWED_MIME_TYPES.has(data.mimeType)) {
        return apiResponse(400, { message: `Unsupported file type: ${data.mimeType}` });
      }
      if (data.fileSizeBytes > MAX_FILE_SIZE_BYTES) {
        return apiResponse(400, { message: `File too large. Maximum: ${MAX_FILE_SIZE_BYTES} bytes` });
      }
    }

    const documentId = uuidv4();
    const now = new Date().toISOString();

    let fileKey: string | null = null;
    let uploadUrl: string | null = null;

    if (!isContentBased) {
      fileKey = buildRFPDocumentS3Key({
        orgId,
        projectId: data.projectId,
        opportunityId: data.opportunityId,
        documentId,
        version: 1,
        fileName: data.originalFileName || data.name,
      });

      const putCmd = new PutObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: fileKey,
        ContentType: data.mimeType,
      });

      uploadUrl = await getSignedUrl(s3Client as any, putCmd, { expiresIn: 900 });
    }

    const sk = `${data.projectId}#${data.opportunityId}#${documentId}`;
    const item: Record<string, any> = {
      [PK_NAME]: RFP_DOCUMENT_PK,
      [SK_NAME]: sk,
      documentId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      orgId,
      name: data.name,
      description: data.description ?? null,
      documentType,
      mimeType: data.mimeType ?? (isContentBased ? 'application/json' : null),
      fileSizeBytes: data.fileSizeBytes ?? 0,
      originalFileName: data.originalFileName ?? null,
      fileKey: fileKey ?? null,
      version: 1,
      previousVersionId: null,
      signatureStatus: 'NOT_REQUIRED',
      signatureDetails: null,
      linearSyncStatus: 'NOT_SYNCED',
      linearCommentId: null,
      lastSyncedAt: null,
      deletedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    // For content-based documents, store structured content and status
    if (isContentBased && data.content) {
      item.content = data.content;
      item.status = data.status ?? 'NEW';
      item.title = data.title ?? data.content?.proposalTitle ?? data.name;
    }

    await putRFPDocument(item);

    const response: Record<string, any> = {
      ok: true,
      document: item,
    };

    // Only include upload info for file-based documents
    if (!isContentBased && uploadUrl && fileKey) {
      response.upload = {
        url: uploadUrl,
        method: 'PUT',
        bucket: DOCUMENTS_BUCKET,
        key: fileKey,
        expiresIn: 900,
      };
    }

    return apiResponse(201, response);
  } catch (err) {
    console.error('Error in create-rfp-document:', err);
    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(middy(baseHandler));
