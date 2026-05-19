import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getRequiredForm } from '@/helpers/required-form';
import { fillPdfForm } from '@/helpers/pdf-form-filler';
import { requireEnv } from '@/helpers/env';

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
  formId: z.string().min(1),
});

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { success, data, error } = QuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!success) return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });

  const form = await getRequiredForm({ orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  const isPdf = form.sourceFileKey.toLowerCase().endsWith('.pdf');

  if (!isPdf) {
    const cmd = new GetObjectCommand({
      Bucket: getDocumentsBucket(),
      Key: form.sourceFileKey,
      ResponseContentDisposition: `attachment; filename="${form.sourceFileName}"`,
    });
    const downloadUrl = await getSignedUrl(s3Client, cmd, { expiresIn: 3600 });
    return apiResponse(200, { downloadUrl, fileName: form.sourceFileName });
  }

  const outputKey = `${orgId}/${data.projectId}/${data.opportunityId}/required-forms/${data.formId}/filled.pdf`;

  await fillPdfForm({
    sourceFileKey: form.sourceFileKey,
    fields: form.fields,
    outputKey,
  });

  const cmd = new GetObjectCommand({
    Bucket: getDocumentsBucket(),
    Key: outputKey,
    ResponseContentDisposition: `attachment; filename="filled_${form.sourceFileName}"`,
  });
  const downloadUrl = await getSignedUrl(s3Client, cmd, { expiresIn: 3600 });

  return apiResponse(200, { downloadUrl, fileName: `filled_${form.sourceFileName}` });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
