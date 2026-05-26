import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { getRequiredForm, updateRequiredForm } from '@/helpers/required-form';
import { startFormsAnalysis } from '@/helpers/textract-forms';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

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

  const form = await getRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
  });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  const isPdf = form.sourceFileKey.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    return apiResponse(400, { message: 'Reprocessing is only supported for PDF forms' });
  }

  await updateRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
    patch: { status: 'IN_PROGRESS', errorMessage: null },
  });

  try {
    const jobId = await startFormsAnalysis({
      bucket: requireEnv('DOCUMENTS_BUCKET'),
      fileKey: form.sourceFileKey,
      jobTag: form.formId,
      snsTopicArn: requireEnv('TEXTRACT_FORMS_SNS_TOPIC_ARN'),
      roleArn: requireEnv('TEXTRACT_FORMS_ROLE_ARN'),
    });
    return apiResponse(202, { ok: true, jobId, status: 'IN_PROGRESS' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateRequiredForm({
      orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
      patch: { status: 'FAILED', errorMessage: message },
    });
    return apiResponse(500, { message: `Reprocessing failed to start: ${message}` });
  }
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
