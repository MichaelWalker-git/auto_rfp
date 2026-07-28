/**
 * POST /compliance-review/chat
 *
 * Synchronous, conversational compliance review. Uses a fast model (Haiku) with
 * bounded tool rounds to stay under the API Gateway 29s limit. Returns an answer
 * plus any findings relevant to what the user asked, and persists the message pair.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { getOpportunity } from '@/helpers/opportunity';
import { runChatReview } from '@/helpers/compliance-review-engine';
import { saveComplianceMessagePair } from '@/helpers/compliance-review';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import {
  ComplianceReviewChatRequestSchema,
  ComplianceReviewChatResponseSchema,
} from '@auto-rfp/core';

const CHAT_MODEL_ID = requireEnv(
  'COMPLIANCE_REVIEW_CHAT_MODEL_ID',
  'us.anthropic.claude-haiku-4-5-20251001-v1:0',
);

const QueryParamsSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
});

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const { success: qOk, data: query, error: qErr } = QueryParamsSchema.safeParse(event.queryStringParameters);
  if (!qOk) {
    return apiResponse(400, { message: 'Invalid query parameters', issues: qErr.issues });
  }
  const { orgId, projectId, opportunityId: oppId } = query;

  const { success, data, error } = ComplianceReviewChatRequestSchema.safeParse(
    JSON.parse(event.body || '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) return apiResponse(404, { message: 'Opportunity not found' });

  const userName =
    (event.auth?.claims?.name as string | undefined) ??
    (event.auth?.claims?.email as string | undefined) ??
    'system';

  const { answer: rawAnswer, findings } = await runChatReview({
    orgId,
    projectId,
    oppId,
    modelId: CHAT_MODEL_ID,
    message: data.message,
  });

  // The model may return findings with no summary text (or be cut off mid-gather
  // within the chat's tight round budget). Never surface a blank chat bubble.
  const answer =
    rawAnswer.trim() ||
    (findings.length > 0
      ? `I found ${findings.length} potential issue${findings.length === 1 ? '' : 's'} — see below.`
      : 'I could not find enough in the package to answer that. Try running a full review or asking about a specific document or requirement.');

  const { assistantMsg } = await saveComplianceMessagePair({
    orgId,
    projectId,
    oppId,
    userMessage: data.message,
    assistantAnswer: answer,
    findings,
    userId: event.auth?.userId,
  });

  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId: event.auth?.userId ?? 'system',
      userName,
      organizationId: orgId,
      action: 'COMPLIANCE_REVIEW_MESSAGE_SENT',
      resource: 'compliance_review_chat',
      resourceId: assistantMsg.messageId,
      changes: { after: { oppId, findingsCount: findings.length, answerLength: answer.length } },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('Failed to write audit log (non-blocking):', err));

  return apiResponse(
    200,
    ComplianceReviewChatResponseSchema.parse({ answer, findings, messageId: assistantMsg.messageId }),
  );
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);
