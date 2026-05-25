import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { deleteRequiredForm, getRequiredForm } from '@/helpers/required-form';
import { detachFormFromProposal } from '@/helpers/required-form-proposal-bridge';

import {
  AuthedEvent,
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

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  // Deleting a required form is destructive: any user-entered field values
  // are lost. Restrict to ADMIN even though EDITOR has document:delete for
  // other resources.
  if (event.rbac?.role !== 'ADMIN') {
    return apiResponse(403, { message: 'Only admins can delete required forms' });
  }

  const { success, data, error } = QuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!success) return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });

  // If the form was auto-attached to the proposal, soft-delete the bridge RFP
  // document first so the proposal package doesn't ship a file that no longer
  // exists. detachFormFromProposal is idempotent — safe when nothing is attached.
  const form = await getRequiredForm({
    orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId,
  });
  if (form?.proposalDocumentId) {
    await detachFormFromProposal({
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      proposalDocumentId: form.proposalDocumentId,
      userId: getUserId(event) ?? 'system',
    });
  }

  await deleteRequiredForm({ orgId, projectId: data.projectId, opportunityId: data.opportunityId, formId: data.formId });

  return apiResponse(200, { ok: true });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:delete'))
    .use(httpErrorMiddleware()),
);
