import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withSentryLambda } from '../sentry-lambda';
import { getRFPDocument } from '../helpers/rfp-document';

const { apiResponse, getOrgId } = require('../helpers/api');
const { requireEnv } = require('../helpers/env');

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const s3Client = new S3Client({});

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const body = event.body ? JSON.parse(event.body) : {};
    const projectId = body.projectId || event.queryStringParameters?.projectId;
    const opportunityId = body.opportunityId || event.queryStringParameters?.opportunityId;
    const documentId = body.documentId || event.queryStringParameters?.documentId;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const doc = await getRFPDocument(projectId, opportunityId, documentId);
    if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
    if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

    const cmd = new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: doc.fileKey, ResponseContentDisposition: 'inline', ResponseContentType: doc.mimeType });
    const url = await getSignedUrl(s3Client as any, cmd, { expiresIn: 3600 });

    return apiResponse(200, { ok: true, url, mimeType: doc.mimeType, fileName: doc.name, expiresIn: 3600 });
  } catch (err) {
    console.error('Error in get-document-preview-url:', err);
    return apiResponse(500, { message: 'Internal server error', error: err instanceof Error ? err.message : 'Unknown error' });
  }
};

export const handler = withSentryLambda(middy(baseHandler));