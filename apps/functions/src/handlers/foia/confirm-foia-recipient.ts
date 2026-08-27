import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getUserId } from '@/helpers/api';
import { transitionFoiaAutomationState, syncOpportunityFoiaMarker } from '@/helpers/foia-automation';
import { getOpportunity } from '@/helpers/opportunity';
import { upsertAgencyContact } from '@/helpers/foia-agency-contact';
import { ConfirmFoiaRecipientSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event) ?? 'system';

  const { success, data, error } = ConfirmFoiaRecipientSchema.safeParse(
    JSON.parse(event.body ?? '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const { orgId, projectId, oppId, foiaEmail, foiaAddress, saveToDirectory } = data;

  // Load the opportunity to get the organization name
  const opportunityRes = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunityRes) {
    return apiResponse(404, { message: 'Opportunity not found' });
  }

  // Save to directory if requested
  if (saveToDirectory !== false) {
    await upsertAgencyContact(
      orgId,
      {
        orgId,
        agencyName: opportunityRes.item.organizationName ?? 'Unknown Agency',
        foiaEmail,
        foiaAddress,
        acceptsEmail: true,
      },
      userId,
    );
  }

  // Transition from BLOCKED to SCHEDULED
  const result = await transitionFoiaAutomationState({
    orgId,
    projectId,
    oppId,
    from: ['BLOCKED'],
    to: 'SCHEDULED',
    patch: {
      resolvedRecipientEmail: foiaEmail,
      resolvedRecipientAddress: foiaAddress,
      recipientSource: 'USER_PROVIDED',
      blockedReason: null,
      recipientCandidates: [],
    },
    updatedBy: userId,
  });

  if (result === null) {
    return apiResponse(409, {
      message: 'Automation state changed concurrently. Refresh and try again.',
    });
  }

  await syncOpportunityFoiaMarker(orgId, projectId, oppId, result.state);

  return apiResponse(200, { automation: result });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(httpErrorMiddleware()),
);
