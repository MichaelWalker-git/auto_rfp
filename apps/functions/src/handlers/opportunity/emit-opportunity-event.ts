/**
 * Emit opportunity data to EventBridge for downstream processing.
 *
 * POST /opportunity/emit-event
 * Body: { orgId, projectId, oppId }
 *
 * Fetches the opportunity from DynamoDB, lists its attachments (question files)
 * with S3 bucket/key info, and emits a single EventBridge event.
 *
 * Idempotent: records `eventBridgeEmittedAt` on the opportunity.
 * Rejects duplicate emissions unless force=true.
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { getOpportunity, updateOpportunity } from '@/helpers/opportunity';
import { listQuestionFilesByOpportunity } from '@/helpers/questionFile';
import { nowIso } from '@/helpers/date';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const EVENT_BUS_NAME = process.env.OPPORTUNITY_EVENT_BUS_NAME || 'default';
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');

const ebClient = new EventBridgeClient({ region: REGION });

const RequestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  force: z.boolean().optional().default(false),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const body = JSON.parse(event.body ?? '{}');
  const { success, data, error } = RequestSchema.safeParse(body);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const { orgId, projectId, oppId, force } = data;

  // Fetch the opportunity
  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) {
    return apiResponse(404, { message: 'Opportunity not found' });
  }

  // Idempotency check: reject if already emitted (unless force=true)
  const existingEmit = (opportunity as Record<string, unknown>).eventBridgeEmittedAt;
  if (existingEmit && !force) {
    return apiResponse(409, {
      message: 'Event already emitted',
      emittedAt: existingEmit,
    });
  }

  // List attachments (question files) with S3 info
  const { items: questionFiles } = await listQuestionFilesByOpportunity({ projectId, oppId });
  const attachments = questionFiles
    .filter((qf: Record<string, unknown>) => qf.fileKey && qf.status !== 'DELETED')
    .map((qf: Record<string, unknown>) => ({
      questionFileId: qf.questionFileId,
      fileName: qf.originalFileName ?? qf.fileName,
      fileKey: qf.fileKey,
      bucket: DOCUMENTS_BUCKET,
      mimeType: qf.mimeType,
      status: qf.status,
      fileSize: qf.fileSize,
    }));

  // Build the event payload
  const eventDetail = {
    opportunity,
    attachments,
    metadata: {
      emittedAt: nowIso(),
      emittedBy: event.auth?.userId,
      orgId,
      projectId,
      oppId,
    },
  };

  // Emit to EventBridge
  await ebClient.send(new PutEventsCommand({
    Entries: [{
      Source: 'auto-rfp.opportunity',
      DetailType: 'OpportunityGoDecision',
      Detail: JSON.stringify(eventDetail),
      EventBusName: EVENT_BUS_NAME,
    }],
  }));

  // Mark as emitted (idempotency)
  await updateOpportunity({
    orgId,
    projectId,
    oppId,
    patch: { eventBridgeEmittedAt: nowIso() } as Record<string, unknown>,
  });

  setAuditContext(event, {
    action: 'OPPORTUNITY_EVENT_EMITTED',
    resource: 'opportunity',
    resourceId: oppId,
  });

  return apiResponse(200, {
    message: 'Event emitted successfully',
    emittedAt: eventDetail.metadata.emittedAt,
    attachmentCount: attachments.length,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);