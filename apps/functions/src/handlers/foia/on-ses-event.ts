import type { SNSEvent } from 'aws-lambda';
import middy from '@middy/core';

import { normalizeAgencyKey } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { nowIso } from '@/helpers/date';
import { listFoiaAutomationsForScan, transitionFoiaAutomationState, syncOpportunityFoiaMarker } from '@/helpers/foia-automation';
import { markAgencyContactBounced } from '@/helpers/foia-agency-contact';
import { getOpportunity } from '@/helpers/opportunity';
import { buildNotification, sendNotification } from '@/helpers/send-notification';
import { getOrgMembers } from '@/helpers/user';

/**
 * Handles SES delivery events for FOIA sends.
 *
 * Without this, a rejected statutory request is indistinguishable from a
 * delivered one: SES accepts the message, the record says SENT, and the FOIA
 * deadline passes with nobody aware. That silent-failure mode is the reason
 * unattended sending stays gated until this is deployed.
 *
 * Correlation is by SES message id, which the send path stores on the automation
 * record as `sesMessageId`.
 */

/** The subset of the SES event notification we consume. */
interface SesEventNotification {
  eventType?: string;
  /** Older SNS-direct notifications use `notificationType` instead. */
  notificationType?: string;
  mail?: { messageId?: string };
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string; status?: string }>;
  };
  complaint?: {
    complainedRecipients?: Array<{ emailAddress?: string }>;
    complaintFeedbackType?: string;
  };
}

/** A one-line human-readable reason, for the marker and the notification. */
const describeFailure = (event: SesEventNotification): string => {
  if (event.bounce) {
    const r = event.bounce.bouncedRecipients?.[0];
    const detail = r?.diagnosticCode ?? r?.status ?? 'no diagnostic returned';
    return `${event.bounce.bounceType ?? 'Bounce'}/${event.bounce.bounceSubType ?? 'unknown'}: ${detail}`;
  }
  if (event.complaint) {
    return `Complaint${event.complaint.complaintFeedbackType ? `: ${event.complaint.complaintFeedbackType}` : ''}`;
  }
  return 'Delivery failed';
};

export const baseHandler = async (event: SNSEvent) => {
  let handled = 0;
  let matched = 0;

  for (const record of event.Records) {
    let notification: SesEventNotification;
    try {
      notification = JSON.parse(record.Sns.Message) as SesEventNotification;
    } catch {
      console.warn('[foia-ses-event] unparseable SNS message, skipping');
      continue;
    }

    const type = (notification.eventType ?? notification.notificationType ?? '').toLowerCase();
    const messageId = notification.mail?.messageId;

    handled += 1;

    if (!messageId) {
      console.warn(`[foia-ses-event] ${type} event with no messageId, cannot correlate`);
      continue;
    }

    // Delivery is the happy path: log it so "accepted by SES" can be told apart
    // from "reached the agency", but there is no state change to make.
    if (type === 'delivery') {
      console.log(`[foia-ses-event] delivered ${messageId}`);
      continue;
    }

    const isFailure = type === 'bounce' || type === 'complaint' || type === 'reject';
    if (!isFailure) {
      console.log(`[foia-ses-event] ignoring ${type} for ${messageId}`);
      continue;
    }

    // Correlate by message id. Scanning the automation partition is acceptable
    // here: bounces are rare, and adding a GSI for them would cost more than it
    // saves. `listFoiaAutomationsForScan` is fully paginated.
    const automations = await listFoiaAutomationsForScan();
    const automation = automations.find((a) => a.sesMessageId === messageId);

    if (!automation) {
      console.warn(`[foia-ses-event] no FOIA automation matches ${messageId}`);
      continue;
    }

    matched += 1;

    const reason = describeFailure(notification);
    const { orgId, projectId, oppId } = automation;

    // Only a SENT record can bounce. A record already moved on (cancelled,
    // manually completed) is left alone rather than dragged backwards.
    const moved = await transitionFoiaAutomationState({
      orgId,
      projectId,
      oppId,
      from: 'SENT',
      to: 'BOUNCED',
      patch: { bounceReason: reason, lastError: reason, lastAttemptAt: nowIso() },
    });

    if (!moved) {
      console.warn(
        `[foia-ses-event] ${messageId} bounced but its record is in ${automation.state}, not SENT`,
      );
      continue;
    }

    await syncOpportunityFoiaMarker(orgId, projectId, oppId, 'BOUNCED');

    // Stop reusing a dead mailbox. Without this the next opportunity for the
    // same agency resolves to the same bad address and fails identically.
    //
    // The directory is keyed on the AGENCY NAME, which lives on the opportunity
    // rather than the automation record — hence the read. Keying off
    // `resolvedRecipientAddress` (a postal address) would never match.
    const opportunity = await getOpportunity({ orgId, projectId, oppId }).catch(() => null);
    const agencyName = opportunity?.item?.organizationName;

    if (agencyName) {
      await markAgencyContactBounced(orgId, normalizeAgencyKey(agencyName), reason).catch((err) =>
        console.warn(
          '[foia-ses-event] could not flag the agency contact:',
          (err as Error).message,
        ),
      );
    }

    await getOrgMembers(orgId)
      .then((members) =>
        members.length === 0
          ? undefined
          : sendNotification(
              buildNotification(
                'FOIA_BOUNCED',
                'FOIA request was not delivered',
                `The FOIA request was rejected by the agency's mail server (${reason}). It needs a new address before it can be re-sent.`,
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
      .catch((err) => console.warn('[foia-ses-event] notification failed:', (err as Error).message));

    console.error(`[foia-ses-event] ${messageId} -> BOUNCED for ${oppId}: ${reason}`);
  }

  return { ok: true, handled, matched };
};

export const handler = withSentryLambda(middy(baseHandler));
