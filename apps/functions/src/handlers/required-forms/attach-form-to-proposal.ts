import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { getRequiredForm, updateRequiredForm } from '@/helpers/required-form';
import {
  attachFormAsRfpDocument,
  detachFormFromProposal,
} from '@/helpers/required-form-proposal-bridge';

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

const BodySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  formId: z.string().min(1),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const userId = getUserId(event) ?? 'system';

  const isAttach = (event.requestContext?.http?.method ?? '').toUpperCase() === 'POST';

  const raw = isAttach && event.body ? JSON.parse(event.body) : (event.queryStringParameters ?? {});
  const Schema = isAttach ? BodySchema : QuerySchema;
  const { success, data, error } = Schema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const form = await getRequiredForm({
    orgId,
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    formId: data.formId,
  });
  if (!form) return apiResponse(404, { message: 'Form not found' });

  let proposalDocumentId: string | null = form.proposalDocumentId ?? null;
  let createdNewBridge = false;

  if (isAttach && !proposalDocumentId) {
    proposalDocumentId = await attachFormAsRfpDocument({ form, userId });
    createdNewBridge = true;
  } else if (!isAttach && proposalDocumentId) {
    await detachFormFromProposal({
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      proposalDocumentId,
      userId,
    });
    proposalDocumentId = null;
  }

  try {
    const updated = await updateRequiredForm({
      orgId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      formId: data.formId,
      patch: {
        attachedToProposal: isAttach,
        attachedAt: isAttach ? new Date().toISOString() : null,
        proposalDocumentId,
      },
      // Only enforce the "unattached" condition when we just minted a new
      // bridge — concurrent re-attaches and detaches don't need it.
      requireUnattached: createdNewBridge,
    });
    return apiResponse(200, { form: updated });
  } catch (err) {
    if (createdNewBridge && proposalDocumentId && (err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      await detachFormFromProposal({
        projectId: data.projectId,
        opportunityId: data.opportunityId,
        proposalDocumentId,
        userId,
      });
      return apiResponse(409, { message: 'Form was attached by another request — refresh and retry' });
    }
    throw err;
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
