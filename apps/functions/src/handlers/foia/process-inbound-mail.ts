import type { SESEvent } from 'aws-lambda';
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

    // Message-ID from the headers, not SES's receipt id: SES assigns a fresh one
    // per delivery, so keying dedupe on that would let a retry through twice.
    const rawKey = receipt?.action?.type === 'S3' ? receipt.action.objectKey : undefined;

    let raw = '';
    if (bucket && rawKey) {
      raw = await readRawMessage(bucket, rawKey).catch((err) => {
        console.error('[foia-inbound] could not read raw message', rawKey, err);
        return '';
      });
    }

    const subject = mail.commonHeaders?.subject ?? readMailHeader(raw, 'Subject') ?? '';
    const from = mail.commonHeaders?.from?.[0] ?? mail.source ?? '';
    const rfcMessageId =
      readMailHeader(raw, 'Message-ID') ?? mail.commonHeaders?.messageId ?? mail.messageId;

    // Which tenant owns this mailbox. Nothing may be touched without it: inbound
    // mail carries no tenant, and an unattributed write in a shared table could
    // put one customer's correspondence on another's opportunity.
    const orgId = await findOrgByScrapeMailbox(mail.destination ?? []);
    if (!orgId) {
      console.warn(
        '[foia-inbound] no org claims',
        mail.destination,
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
