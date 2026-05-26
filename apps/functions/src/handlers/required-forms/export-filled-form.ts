import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { getRequiredForm, updateRequiredForm } from '@/helpers/required-form';
import { syncFormFilledFileToProposal } from '@/helpers/required-form-proposal-bridge';
import { fillPdfForm } from '@/helpers/pdf-form-filler';
import { fillXlsxForm } from '@/helpers/xlsx-form-filler';
import { requireEnv } from '@/helpers/env';

import {
  AuthedEvent,
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

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const userId = getUserId(event) ?? 'system';

  const { success, data, error } = QuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!success) return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });

  const form = await getRequiredForm({ orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  const lowerKey = form.sourceFileKey.toLowerCase();
  const isPdf = lowerKey.endsWith('.pdf');
  const isXlsx = lowerKey.endsWith('.xlsx') || lowerKey.endsWith('.xls');

  let outputKey: string;

  if (isPdf) {
    outputKey = `${orgId}/${data.projectId}/${data.opportunityId}/required-forms/${data.formId}/filled.pdf`;
    await fillPdfForm({
      sourceFileKey: form.sourceFileKey,
      fields: form.fields,
      outputKey,
    });
  } else if (isXlsx) {
    outputKey = `${orgId}/${data.projectId}/${data.opportunityId}/required-forms/${data.formId}/filled.xlsx`;
    await fillXlsxForm({
      sourceFileKey: form.sourceFileKey,
      fields: form.fields,
      outputKey,
    });
  } else {
    // Unsupported type — fall back to streaming the source file unchanged.
    const cmd = new GetObjectCommand({
      Bucket: getDocumentsBucket(),
      Key: form.sourceFileKey,
      ResponseContentDisposition: `attachment; filename="${form.sourceFileName}"`,
    });
    const downloadUrl = await getSignedUrl(s3Client, cmd, { expiresIn: 3600 });
    return apiResponse(200, { downloadUrl, fileName: form.sourceFileName });
  }

  // Persist the filled key on the form so the proposal-bridge picks it up.
  await updateRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
    patch: { filledFileKey: outputKey },
  });

  // If the form is already attached to the proposal, the bridge RFP document
  // was created pointing at sourceFileKey (or a previous filledFileKey). Sync
  // its fileKey to the freshly exported one so the proposal ships the latest
  // filled file, not the stale source.
  if (form.proposalDocumentId) {
    await syncFormFilledFileToProposal({
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      proposalDocumentId: form.proposalDocumentId,
      filledFileKey: outputKey,
      userId,
    });
  }

  const cmd = new GetObjectCommand({
    Bucket: getDocumentsBucket(),
    Key: outputKey,
    ResponseContentDisposition: `attachment; filename="filled_${form.sourceFileName}"`,
  });
  const downloadUrl = await getSignedUrl(s3Client, cmd, { expiresIn: 3600 });

  return apiResponse(200, { downloadUrl, fileName: `filled_${form.sourceFileName}` });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(httpErrorMiddleware()),
);
