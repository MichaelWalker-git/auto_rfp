import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { DetectedFormFieldSchema } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getRequiredForm, updateRequiredForm } from '@/helpers/required-form';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const BodySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  formId: z.string().min(1),
  fields: z.array(DetectedFormFieldSchema),
});

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const raw = event.body ? JSON.parse(event.body) : {};
  const { success, data, error } = BodySchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const form = await getRequiredForm({ orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  const autoFilled = data.fields.filter((f) => f.status === 'AUTO_FILLED').length;
  const manual = data.fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
  const total = data.fields.length;

  const updated = await updateRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
    patch: {
      fields: data.fields,
      autoFillPercentage: total > 0 ? Math.round((autoFilled / total) * 100) : 0,
      manualFieldCount: manual,
      totalFieldCount: total,
    },
  });

  return apiResponse(200, { ok: true, form: updated });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
