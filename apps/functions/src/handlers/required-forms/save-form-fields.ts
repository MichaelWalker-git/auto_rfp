import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { DetectedFormFieldSchema } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { getRequiredForm, updateRequiredForm } from '@/helpers/required-form';
import { attachFormAsRfpDocument } from '@/helpers/required-form-proposal-bridge';

import {
  AuthedEvent,
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import { FormProcessingStatusSchema } from '@auto-rfp/core';

const BodySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  formId: z.string().min(1),
  fields: z.array(DetectedFormFieldSchema),
  status: FormProcessingStatusSchema.optional(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const userId = getUserId(event) ?? 'system';

  const raw = event.body ? JSON.parse(event.body) : {};
  const { success, data, error } = BodySchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const form = await getRequiredForm({ orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  const autoFilled = data.fields.filter((f) => f.status === 'AUTO_FILLED').length;
  const manual = data.fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
  const total = data.fields.length;

  // Auto-attach to the next proposal generation when the form transitions to DONE
  // for the first time. Once detached by the user, we don't re-attach.
  const transitioningToDone = data.status === 'DONE' && form.status !== 'DONE';
  const shouldAutoAttach = transitioningToDone && !form.attachedToProposal && !form.proposalDocumentId;

  let proposalDocumentId: string | null | undefined;
  if (shouldAutoAttach) {
    proposalDocumentId = await attachFormAsRfpDocument({ form, userId });
  }

  const updated = await updateRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
    patch: {
      fields: data.fields,
      autoFillPercentage: total > 0 ? Math.round((autoFilled / total) * 100) : 0,
      manualFieldCount: manual,
      totalFieldCount: total,
      ...(data.status ? { status: data.status } : {}),
      ...(shouldAutoAttach ? {
        attachedToProposal: true,
        attachedAt: new Date().toISOString(),
        proposalDocumentId: proposalDocumentId ?? null,
      } : {}),
    },
  });

  return apiResponse(200, { ok: true, form: updated });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
