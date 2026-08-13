import type { SESEvent, SESMessage } from 'aws-lambda';
import middy from '@middy/core';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { computeFoiaScheduledSendAt } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { nowIso } from '@/helpers/date';
import { getFoiaSettings, findOrgByScrapeMailbox } from '@/helpers/foia-settings';
import { listOpportunitiesByOrg, updateOpportunity } from '@/helpers/opportunity';
import {
  getFoiaAutomation,
  setFoiaAutomationState,
  syncOpportunityFoiaMarker,
} from '@/helpers/foia-automation';
import {
  awardDateFromMail,
  claimInboundMessage,
  decideInboundMail,
  toCorrelationCandidates,
  type MailIngestResult,
} from '@/helpers/foia-mail-ingest';
import { parseRawMail, readMailHeader } from '@/helpers/foia-mail-parse';
import { buildNotification, sendNotification } from '@/helpers/send-notification';
import { getOrgMembers } from '@/helpers/user';

/**
 * Level 1: reads forwarded procurement mail and acts on award notices and
 * cancellations.
 *
 * Invoked by an SES receipt rule after the raw message is already durable in S3.
 * That ordering matters: the store action runs first, so a failure here cannot
 * lose a message SES has already accepted — the object remains and the invocation
 * can be replayed.
 *
 * The handler is deliberately conservative. Level 2's timer is the guaranteed
 * path, so the cost of ignoring a message is a delay, while the cost of acting on
 * the wrong one is a statutory request filed against the wrong agency about the
 * wrong procurement, in a customer's name. Every stage can refuse, and refusing
 * is always the safe branch.
 */

const s3 = new S3Client({ region: process.env.AWS_REGION });

/**
 * The prefix the receipt rule's S3 action writes under.
 *
 * Must stay in step with `objectKeyPrefix` in `FoiaInboundStack`. It is needed
 * here because the key has to be reconstructed rather than read — see
 * `locateStoredMessage`.
 */
const INBOUND_KEY_PREFIX = 'inbound/';

/**
 * Works out where SES stored the raw message.
 *
 * A receipt rule reports the action *currently executing*, so a Lambda action
 * receives `action.type === 'Lambda'` — never the `S3` action that ran before it
 * in the same rule. Reading `objectKey` off the reported action therefore always
 * yielded undefined, the raw message was never fetched, and every message was
 * classified from its subject line alone. That failed silently in the worst
 * possible way: with no body, an award notice fell back to the receipt date, so a
 * real award of 1/29/2026 was recorded as 2026-08-12 and the FOIA timer was
 * anchored 195 days late.
 *
 * The key is reconstructable because the S3 action names each object after
 * `mail.messageId` under its configured prefix. The reported action is still
 * preferred when it *is* the S3 one, so an SNS-fanout or S3-only wiring keeps
 * working without depending on the prefix constant.
 */
const locateStoredMessage = (receipt: SESMessage['receipt'], messageId: string): string | undefined => {
  const action = receipt?.action;
  if (action?.type === 'S3') return action.objectKey;
  return messageId ? `${INBOUND_KEY_PREFIX}${messageId}` : undefined;
};

/** Reads the raw message SES stored. */
const readRawMessage = async (bucket: string, key: string): Promise<string> => {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await result.Body?.transformToString('utf8');
  return body ?? '';
};

/**
 * Applies an award notice: records the date and re-anchors the FOIA timer.
 *
 * This is the whole point of Level 1. A real award date replaces a date inferred
 * from the bid deadline, which is what stops the timer firing before the award
 * exists — on the real TTUHSC solicitation the deadline preceded the award by 108
 * days, so the inferred date would have produced a premature filing.
 */
const applyAwardNotice = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  bodyText: string;
  receivedAt: string;
}): Promise<void> => {
  const { orgId, projectId, oppId, bodyText, receivedAt } = args;

  const { date } = awardDateFromMail({ receivedAt, bodyText });

  await updateOpportunity({
    orgId,
    projectId,
    oppId,
    patch: { outcomeDate: date },
  });

  // Re-anchor the schedule to the real award. Only touch a record still waiting:
  // a request already prepared, sent or manually completed is not ours to move.
  const automation = await getFoiaAutomation(orgId, projectId, oppId);
  if (!automation || !['NOT_APPLICABLE', 'SCHEDULED'].includes(automation.state)) return;

  const settings = await getFoiaSettings(orgId);
  const scheduledSendAt = computeFoiaScheduledSendAt({
    submittedAt: date,
    responseDeadlineIso: null,
    delayDays: automation.delayDaysOverride ?? settings.delayDays,
  });

  await setFoiaAutomationState({
    orgId,
    projectId,
    oppId,
    state: 'SCHEDULED',
    patch: { scheduledSendAt },
  });
};

/** Suppresses the automation for a cancelled solicitation. */
const applyCancellation = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  receivedAt: string;
}): Promise<void> => {
  const { orgId, projectId, oppId, receivedAt } = args;

  const automation = await getFoiaAutomation(orgId, projectId, oppId);
  // A request already sent cannot be un-sent; suppressing it would misreport
  // history. Only a pending automation is withdrawn.
  if (automation && !['NOT_APPLICABLE', 'SCHEDULED', 'BLOCKED'].includes(automation.state)) return;

  await setFoiaAutomationState({
    orgId,
    projectId,
    oppId,
    state: 'SUPPRESSED',
    patch: {
      suppressionReason: 'SOLICITATION_CANCELLED',
      suppressedReason: `Agency cancelled the solicitation (detected ${receivedAt.slice(0, 10)})`,
    },
  });

  await syncOpportunityFoiaMarker(orgId, projectId, oppId, 'SUPPRESSED');
};

/** Records an agency reply against the automation. */
const applyResponse = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  result: MailIngestResult;
  receivedAt: string;
  s3Key: string;
}): Promise<void> => {
  const { orgId, projectId, oppId, result, receivedAt } = args;

  const automation = await getFoiaAutomation(orgId, projectId, oppId);
  if (!automation) return;

  await setFoiaAutomationState({
    orgId,
    projectId,
    oppId,
    // The lifecycle state is unchanged — a reply says nothing about where the
    // request is, only about what came back.
    state: automation.state,
    patch: {
      responseOutcome: result.responseOutcome ?? 'ACKNOWLEDGED',
      responseReceivedAt: receivedAt,
      ...(result.classification.trackingNumber
        ? { agencyTrackingNumber: result.classification.trackingNumber }
        : {}),
    },
  });
};

/** Tells the org what happened, so an automated decision is never invisible. */
const notifyOrg = async (args: {
  orgId: string;
  projectId: string;
  oppId?: string;
  result: MailIngestResult;
  subject: string;
}): Promise<void> => {
  const { orgId, projectId, oppId, result, subject } = args;

  const type =
    result.action === 'AWARD_RECORDED'
      ? 'AWARD_DETECTED'
      : result.action === 'SUPPRESSED'
        ? 'SOLICITATION_CANCELLED'
        : undefined;

  // Only the two schedule-changing actions are worth interrupting someone for.
  // Replies and our own outbound mail are visible on the opportunity already, and
  // notifying on every message would train people to ignore the channel.
  if (!type) return;

  const members = await getOrgMembers(orgId).catch(() => []);
  if (members.length === 0) return;

  await Promise.all(
    members.map((member) =>
      sendNotification(
        buildNotification(
          type,
          type === 'AWARD_DETECTED' ? 'Award detected from agency email' : 'Solicitation cancelled',
          subject.slice(0, 300),
          {
            orgId,
            ...(projectId ? { projectId } : {}),
            ...(oppId ? { entityId: oppId } : {}),
            recipientUserIds: [member.userId],
          },
        ),
      ).catch(() => undefined),
    ),
  );
};

export const processInboundMail = async (event: SESEvent): Promise<void> => {
  const bucket = process.env.FOIA_INBOUND_BUCKET;

  for (const record of event.Records) {
    const { mail, receipt } = record.ses;
    const receivedAt = mail.timestamp ?? nowIso();

    const rawKey = locateStoredMessage(receipt, mail.messageId);

    let raw = '';
    if (bucket && rawKey) {
      raw = await readRawMessage(bucket, rawKey).catch((err) => {
        console.error('[foia-inbound] could not read raw message', rawKey, err);
        return '';
      });
    }

    const subject = mail.commonHeaders?.subject ?? readMailHeader(raw, 'Subject') ?? '';
    const from = mail.commonHeaders?.from?.[0] ?? mail.source ?? '';
    /**
     * Dedupe key, in descending order of stability.
     *
     * The RFC Message-ID is preferred because it survives redelivery, whereas SES
     * assigns a fresh receipt id each time. But it is not guaranteed to be
     * readable — a body we cannot parse yields nothing — so the SES ids act as a
     * fallback. They still dedupe a *repeat invocation* of the same receipt, which
     * is the retry case that actually matters here; they only fail to dedupe a
     * genuine redelivery, which is far rarer than losing the message entirely.
     */
    const rfcMessageId =
      [
        readMailHeader(raw, 'Message-ID'),
        mail.commonHeaders?.messageId,
        mail.messageId,
      ].find((id) => typeof id === 'string' && id.trim().length > 0) ?? '';

    if (!rfcMessageId) {
      // Nothing to dedupe on at all. Acting could double-apply on a retry.
      console.error('[foia-inbound] no usable message id; skipping', rawKey);
      continue;
    }

    /**
     * Which tenant owns this mailbox.
     *
     * `receipt.recipients` FIRST, because that is the SMTP envelope — who SES
     * actually accepted the message for. `mail.destination` is built from the
     * message HEADERS, and a forwarded message keeps the original ones: the real
     * mail that arrived overnight carried `To: proposals@horustech.dev` and
     * `Delivered-To: stevan@horustech.dev`, with our address appearing in neither.
     * Every one of those messages was dropped as unattributable, even though SES
     * had accepted them for `foia@inbox.horustech.dev`.
     *
     * Headers are still consulted as a fallback, since a rule matching a wildcard
     * or an SNS-fanout wiring may not populate the envelope list the same way.
     *
     * Nothing may be touched without a tenant: an unattributed write in a shared
     * table could put one customer's correspondence on another's opportunity.
     */
    const candidateRecipients = [
      ...(receipt?.recipients ?? []),
      ...(mail.destination ?? []),
    ];

    const orgId = await findOrgByScrapeMailbox(candidateRecipients);
    if (!orgId) {
      console.warn(
        '[foia-inbound] no org claims',
        candidateRecipients,
        '— ignoring. Set scrapeMailbox and enable mailScrapeEnabled to opt in.',
      );
      continue;
    }

    const { items: opportunities } = await listOpportunitiesByOrg({ orgId });
    const candidates = toCorrelationCandidates(opportunities);

    const result = decideInboundMail({ from, subject, raw, candidates });

    // Claim before acting. SES retries on any error, and an at-least-once
    // delivery that re-recorded an award or re-attached a document would corrupt
    // the opportunity. Losing this race means someone else already did the work.
    const claimed = await claimInboundMessage({
      messageId: rfcMessageId,
      orgId,
      action: result.action,
      classification: result.classification.classification,
      ...(rawKey ? { s3Key: rawKey } : {}),
      ...(result.match ? { oppId: result.match.candidate.oppId } : {}),
    });

    if (!claimed) {
      console.info('[foia-inbound] already processed', rfcMessageId);
      continue;
    }

    const { text } = parseRawMail(raw);
    const match = result.match;

    try {
      if (result.action === 'AWARD_RECORDED' && match) {
        await applyAwardNotice({
          orgId,
          projectId: match.candidate.projectId,
          oppId: match.candidate.oppId,
          bodyText: `${subject}\n${text}`,
          receivedAt,
        });
      } else if (result.action === 'SUPPRESSED' && match) {
        await applyCancellation({
          orgId,
          projectId: match.candidate.projectId,
          oppId: match.candidate.oppId,
          receivedAt,
        });
      } else if (result.action === 'RESPONSE_ATTACHED' && match) {
        await applyResponse({
          orgId,
          projectId: match.candidate.projectId,
          oppId: match.candidate.oppId,
          result,
          receivedAt,
          s3Key: rawKey ?? '',
        });
      }

      await notifyOrg({
        orgId,
        projectId: match?.candidate.projectId ?? '',
        ...(match ? { oppId: match.candidate.oppId } : {}),
        result,
        subject,
      });
    } catch (err) {
      // The claim is already written, so a retry would skip this message. Log
      // loudly rather than rethrowing into an SES retry that cannot help.
      console.error('[foia-inbound] failed to apply', result.action, rfcMessageId, err);
    }

    console.info(
      `[foia-inbound] ${result.action} org=${orgId} opp=${match?.candidate.oppId ?? '-'} ` +
        `class=${result.classification.classification}/${result.classification.confidence}`,
    );
  }
};

export const handler = withSentryLambda(middy(processInboundMail));
