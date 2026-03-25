import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import middy from '@middy/core';
import { z } from 'zod';

import { calculateFOIADeadline, type FOIAStatusChange } from '@auto-rfp/core';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { FOIA_REQUEST_PK } from '@/constants/organization';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { generateFOIALetter } from './generate-foia-letter';
import type { DBFOIARequestItem } from '@/types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const ses = new SESClient({});

// SES verified sender — must be a verified identity in SES (horustech.dev domain)
const SES_FROM_ADDRESS = process.env['SES_FROM_EMAIL'] ?? 'noreply@horustech.dev';

const SubmitFOIARequestSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  foiaRequestId: z.string().min(1, 'foiaRequestId is required'),
  method: z.enum(['AUTO_EMAIL', 'MANUAL']),
});

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);
    const { success, data, error } = SubmitFOIARequestSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const { orgId, projectId, foiaRequestId, method } = data;
    const userId = event.auth?.userId ?? 'unknown';

    // Fetch the FOIA request
    const foiaRequest = await getFOIARequest(orgId, projectId, foiaRequestId);
    if (!foiaRequest) {
      return apiResponse(404, { message: 'FOIA request not found' });
    }

    // Guard: only DRAFT or READY_TO_SUBMIT can be submitted
    if (foiaRequest.status !== 'DRAFT' && foiaRequest.status !== 'READY_TO_SUBMIT') {
      return apiResponse(400, {
        message: `Cannot submit a FOIA request with status '${foiaRequest.status}'. Only DRAFT or READY_TO_SUBMIT requests can be submitted.`,
      });
    }

    const now = new Date().toISOString();
    const responseDeadline = calculateFOIADeadline(new Date()).toISOString();

    let autoSubmitSuccess = false;
    let autoSubmitError: string | undefined;

    // Attempt auto-submit via SES if requested and agency email is available
    if (method === 'AUTO_EMAIL') {
      if (!foiaRequest.agencyFOIAEmail) {
        return apiResponse(400, {
          message: 'Cannot auto-submit: no agency FOIA email address on record. Use MANUAL method or add an agency email first.',
        });
      }

      const letter = generateFOIALetter(foiaRequest);
      const subject = `FOIA Request — Solicitation ${foiaRequest.solicitationNumber}`;

      try {
        await ses.send(
          new SendEmailCommand({
            Source: SES_FROM_ADDRESS,
            Destination: { ToAddresses: [foiaRequest.agencyFOIAEmail] },
            ReplyToAddresses: [foiaRequest.requesterEmail],
            Message: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: {
                Text: { Data: letter, Charset: 'UTF-8' },
              },
            },
          }),
        );
        autoSubmitSuccess = true;
      } catch (sesErr: unknown) {
        console.error('SES send failed:', sesErr);
        autoSubmitError = sesErr instanceof Error ? sesErr.message : 'SES send failed';
        autoSubmitSuccess = false;
      }
    }

    // Build status history entry
    const historyEntry: FOIAStatusChange = {
      status: 'SUBMITTED',
      changedAt: now,
      changedBy: userId,
      notes: method === 'AUTO_EMAIL'
        ? autoSubmitSuccess
          ? `Auto-submitted via email to ${foiaRequest.agencyFOIAEmail}`
          : `Auto-submit attempted but failed: ${autoSubmitError}`
        : 'Manually submitted',
    };

    // Update the FOIA request to SUBMITTED
    const updatedRequest = await markAsSubmitted(
      foiaRequest,
      now,
      responseDeadline,
      method,
      autoSubmitSuccess,
      autoSubmitError,
      historyEntry,
    );

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: foiaRequestId,
    });

    return apiResponse(200, {
      foiaRequest: updatedRequest,
      autoSubmitted: method === 'AUTO_EMAIL' && autoSubmitSuccess,
      ...(autoSubmitError ? { error: autoSubmitError } : {}),
    });
  } catch (err: unknown) {
    console.error('Error in submitFOIARequest handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

const getFOIARequest = async (
  orgId: string,
  projectId: string,
  foiaRequestId: string,
): Promise<DBFOIARequestItem | null> => {
  const sortKey = `${orgId}#${projectId}#${foiaRequestId}`;
  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: { [PK_NAME]: FOIA_REQUEST_PK, [SK_NAME]: sortKey },
  });
  const result = await docClient.send(cmd);
  return (result.Item as DBFOIARequestItem) ?? null;
};

const markAsSubmitted = async (
  existing: DBFOIARequestItem,
  now: string,
  responseDeadline: string,
  method: 'AUTO_EMAIL' | 'MANUAL',
  autoSubmitSuccess: boolean,
  autoSubmitError: string | undefined,
  historyEntry: FOIAStatusChange,
): Promise<DBFOIARequestItem> => {
  const sortKey = existing[SK_NAME] as string;

  const cmd = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: { [PK_NAME]: FOIA_REQUEST_PK, [SK_NAME]: sortKey },
    UpdateExpression: `SET
      #status = :status,
      submittedAt = :submittedAt,
      submittedDate = :submittedDate,
      submissionMethod = :submissionMethod,
      autoSubmitAttempted = :autoSubmitAttempted,
      autoSubmitSuccess = :autoSubmitSuccess,
      responseDeadline = :responseDeadline,
      statusHistory = list_append(statusHistory, :newHistoryEntry),
      updatedAt = :updatedAt
      ${autoSubmitError !== undefined ? ', autoSubmitError = :autoSubmitError' : ''}
    `,
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': 'SUBMITTED',
      ':submittedAt': now,
      ':submittedDate': now,
      ':submissionMethod': method === 'AUTO_EMAIL' ? 'AUTO_EMAIL' : 'MANUAL_EMAIL',
      ':autoSubmitAttempted': method === 'AUTO_EMAIL',
      ':autoSubmitSuccess': autoSubmitSuccess,
      ':responseDeadline': responseDeadline,
      ':newHistoryEntry': [historyEntry],
      ':updatedAt': now,
      ...(autoSubmitError !== undefined ? { ':autoSubmitError': autoSubmitError } : {}),
    },
    ReturnValues: 'ALL_NEW',
  });

  const result = await docClient.send(cmd);
  return result.Attributes as DBFOIARequestItem;
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
