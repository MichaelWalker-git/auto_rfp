import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getUserId } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { FOIA_MAX_SEND_ATTEMPTS } from '@/constants/foia';
import { getOpportunity } from '@/helpers/opportunity';
import { getOrgPrimaryContact } from '@/helpers/org-contact';
import { getFoiaRequest, updateFoiaRequestFields } from '@/helpers/foia';
import {
  getFoiaAutomation,
  syncOpportunityFoiaMarker,
  transitionFoiaAutomationState,
} from '@/helpers/foia-automation';
import { buildFoiaSubject } from '@/helpers/foia-artifacts';
import { generateFOIALetter } from '@/helpers/foia-letter';
import { sendFoiaRequest } from '@/helpers/foia-send';
import { buildNotification, sendNotification } from '@/helpers/send-notification';
import { getOrgMembers } from '@/helpers/user';

/**
 * Transmits an approved FOIA request to the agency.
 *
 * The state machine is the safety mechanism, not the HTTP layer. SES is called
 * only after a conditional DynamoDB write moves the record
 * AWAITING_APPROVAL -> SENDING, so two concurrent approvals cannot both send:
 * whichever write wins owns the send, and the loser gets a 409.
 *
 * `SENDING` is a lock rather than a resting state. Every exit path from it —
 * success, failure, or an unexpected throw — must move the record on, or the
 * request is stranded and the statutory deadline passes silently.
 */

const SendFoiaRequestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  /** Assemble and validate without calling SES. */
  dryRun: z.boolean().optional(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SendFoiaRequestSchema.safeParse(
    JSON.parse(event.body ?? '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const { orgId, projectId, oppId, dryRun } = data;
  const userId = getUserId(event) ?? 'system';

  const automation = await getFoiaAutomation(orgId, projectId, oppId);
  if (!automation) {
    return apiResponse(404, { message: 'No FOIA automation record for this opportunity' });
  }

  if (!automation.foiaRequestId) {
    return apiResponse(409, {
      message: 'This FOIA request has not been prepared yet',
      state: automation.state,
    });
  }

  if (automation.attemptCount >= FOIA_MAX_SEND_ATTEMPTS) {
    return apiResponse(409, {
      message: `This request has already failed ${automation.attemptCount} times; resolve the cause before retrying`,
      lastError: automation.lastError,
    });
  }

  const [request, opportunity, primaryContact] = await Promise.all([
    getFoiaRequest(orgId, projectId, oppId, automation.foiaRequestId),
    getOpportunity({ orgId, projectId, oppId }),
    getOrgPrimaryContact(orgId).catch(() => null),
  ]);

  if (!request) {
    return apiResponse(404, { message: 'FOIA request record not found' });
  }

  // Claim the send BEFORE touching SES. A FAILED or STALLED record may also be
  // retried, but a SENT one must never be re-sent.
  const claimed = await transitionFoiaAutomationState({
    orgId,
    projectId,
    oppId,
    from: ['AWAITING_APPROVAL', 'STALLED', 'FAILED'],
    to: 'SENDING',
    patch: { lastAttemptAt: nowIso(), attemptCount: automation.attemptCount + 1 },
    updatedBy: userId,
  });

  if (!claimed) {
    return apiResponse(409, {
      message: 'This request is already being sent, or has been sent',
      state: automation.state,
    });
  }

  const isStateRequest = opportunity?.item?.jurisdiction === 'STATE';
  const letter = generateFOIALetter(request, {
    jurisdiction: opportunity?.item?.jurisdiction,
    state: opportunity?.item?.state ?? undefined,
  });
  const subject = buildFoiaSubject({ request, isStateRequest });

  try {
    const result = await sendFoiaRequest({
      request,
      letter,
      subject,
      artifacts: automation.artifacts,
      // Copy the customer so they hold their own record of the filing.
      ccEmail: primaryContact?.email,
      dryRun,
    });

    if (dryRun) {
      // Release the lock without claiming a send happened.
      await transitionFoiaAutomationState({
        orgId,
        projectId,
        oppId,
        from: 'SENDING',
        to: 'AWAITING_APPROVAL',
        patch: { attemptCount: automation.attemptCount },
      });

      return apiResponse(200, {
        ok: true,
        dryRun: true,
        recipient: result.recipient,
        attached: result.attached,
        subject,
        letter,
      });
    }

    const sentAt = nowIso();

    const sent = await transitionFoiaAutomationState({
      orgId,
      projectId,
      oppId,
      from: 'SENDING',
      to: 'SENT',
      patch: { sentAt, sesMessageId: result.messageId, lastError: null },
      updatedBy: userId,
    });

    // The request record carries the audit trail of what was actually filed.
    await updateFoiaRequestFields(orgId, projectId, oppId, request.foiaId, {
      sentAt,
    }).catch((err) =>
      console.warn('[send-foia] could not stamp sentAt on the request:', (err as Error).message),
    );

    await syncOpportunityFoiaMarker(orgId, projectId, oppId, 'SENT');

    getOrgMembers(orgId)
      .then((members) =>
        members.length === 0
          ? undefined
          : sendNotification(
              buildNotification(
                'FOIA_SENT',
                'FOIA request sent',
                `The FOIA request for "${opportunity?.item?.title ?? oppId}" was sent to ${result.recipient}.`,
                {
                  orgId,
                  projectId,
                  entityId: oppId,
                  recipientUserIds: members.map((m) => m.userId),
                  recipientEmails: members.map((m) => m.email),
                  link: `/organizations/${orgId}/projects/${projectId}/opportunities/${oppId}`,
                },
              ),
            ),
      )
      .catch((err) => console.warn('[send-foia] notification failed:', (err as Error).message));

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'foia_request',
      resourceId: request.foiaId,
      orgId,
    });

    return apiResponse(200, {
      ok: true,
      sentAt,
      messageId: result.messageId,
      recipient: result.recipient,
      attached: result.attached,
      automation: sent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Releasing the lock matters more than the send succeeding. Leaving the
    // record in SENDING would strand it: the reconciler will not touch SENDING,
    // so nothing would ever retry or surface it.
    const attempts = automation.attemptCount + 1;
    const exhausted = attempts >= FOIA_MAX_SEND_ATTEMPTS;

    await transitionFoiaAutomationState({
      orgId,
      projectId,
      oppId,
      from: 'SENDING',
      to: 'FAILED',
      patch: { lastError: message, attemptCount: attempts },
    }).catch((releaseErr) =>
      console.error(
        '[send-foia] CRITICAL: send failed AND the lock could not be released:',
        (releaseErr as Error).message,
      ),
    );

    await syncOpportunityFoiaMarker(orgId, projectId, oppId, 'FAILED');

    getOrgMembers(orgId)
      .then((members) =>
        members.length === 0
          ? undefined
          : sendNotification(
              buildNotification(
                'FOIA_SEND_FAILED',
                'FOIA request could not be sent',
                exhausted
                  ? `Sending the FOIA request for "${opportunity?.item?.title ?? oppId}" failed ${attempts} times and will not be retried automatically: ${message}`
                  : `Sending the FOIA request for "${opportunity?.item?.title ?? oppId}" failed: ${message}`,
                {
                  orgId,
                  projectId,
                  entityId: oppId,
                  recipientUserIds: members.map((m) => m.userId),
                  recipientEmails: members.map((m) => m.email),
                  link: `/organizations/${orgId}/projects/${projectId}/opportunities/${oppId}`,
                },
              ),
            ),
      )
      .catch(() => undefined);

    console.error('[send-foia] send failed:', message);

    return apiResponse(502, { message: 'Failed to send the FOIA request', error: message });
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('foia:send'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
