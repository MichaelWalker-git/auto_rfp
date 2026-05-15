import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getRFPDocument } from '@/helpers/rfp-document';
import { fillPdfForm } from '@/helpers/pdf-form-filler';
import { requireEnv } from '@/helpers/env';

import type { DetectedFormField } from '@auto-rfp/core';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const s3Client = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const QuerySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
});

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const documentId = event.pathParameters?.documentId;
  if (!documentId) return apiResponse(400, { message: 'documentId path parameter is required' });

  const { success, data, error } = QuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!success) return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });

  const doc = await getRFPDocument(data.projectId, data.opportunityId, documentId);
  if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
  if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

  const fileKey = doc.fileKey as string | undefined;
  if (!fileKey) return apiResponse(400, { message: 'Document has no source file' });

  const formFields = (doc.formFields as DetectedFormField[]) ?? [];
  const isPdf = fileKey.toLowerCase().endsWith('.pdf');

  if (!isPdf) {
    // For non-PDF files, just return a presigned download URL to the original
    const cmd = new GetObjectCommand({
      Bucket: getDocumentsBucket(),
      Key: fileKey,
      ResponseContentDisposition: `attachment; filename="filled_${doc.originalFileName ?? doc.name}"`,
    });
    const downloadUrl = await getSignedUrl(s3Client, cmd, { expiresIn: 3600 });
    return apiResponse(200, { downloadUrl, fileName: doc.originalFileName ?? doc.name });
  }

  const outputKey = `${orgId}/${data.projectId}/${data.opportunityId}/rfp-documents/${documentId}/filled.pdf`;

  await fillPdfForm({
    sourceFileKey: fileKey,
    fields: formFields,
    outputKey,
  });

  const cmd = new GetObjectCommand({
    Bucket: getDocumentsBucket(),
    Key: outputKey,
    ResponseContentDisposition: `attachment; filename="filled_${doc.originalFileName ?? doc.name}"`,
  });
  const downloadUrl = await getSignedUrl(s3Client, cmd, { expiresIn: 3600 });

  return apiResponse(200, { downloadUrl, fileName: `filled_${doc.originalFileName ?? doc.name}` });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
