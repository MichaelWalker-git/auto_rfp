/**
 * GET /rfp-document/chat-messages
 *
 * Returns persisted AI chat messages for a specific document.
 * Messages are ordered by timestamp ascending (oldest first).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { listChatMessages } from '@/helpers/ai-chat';

// ─── Handler ───

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId, opportunityId, documentId } = event.queryStringParameters ?? {};

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    const messages = await listChatMessages(orgId, projectId, opportunityId, documentId);

    // Strip updatedHtml from response to reduce payload size
    // (the HTML was already applied to the document; no need to send it back)
    const lightMessages = messages.map(({ updatedHtml, ...rest }) => rest);

    return apiResponse(200, {
      ok: true,
      items: lightMessages,
      count: lightMessages.length,
    });
  } catch (err) {
    console.error('Error in get-chat-messages handler:', err);
    return apiResponse(500, { message: 'Internal server error' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
