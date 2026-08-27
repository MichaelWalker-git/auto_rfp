import type { FoiaArtifact, FoiaAutomationDBItem } from '@auto-rfp/core';

import { FOIA_MAX_SEND_ATTEMPTS } from '@/constants/foia';
import { nowIso } from '@/helpers/date';
import { getFoiaRequest, updateFoiaRequestFields } from '@/helpers/foia';
import {
  syncOpportunityFoiaMarker,
  transitionFoiaAutomationState,
} from '@/helpers/foia-automation';
import { buildFoiaSubject, readFoiaLetterText } from '@/helpers/foia-artifacts';
import { generateFOIALetter } from '@/helpers/foia-letter';
import { sendFoiaRequest } from '@/helpers/foia-send';
import { writeFoiaSendAuditLog } from '@/helpers/foia-audit';

/**
 * The one implementation of "transmit this request and move the record on".
 *
 * Extracted so the approval click and the unattended path cannot drift. They
 * differ only in what authorises the send — a human, or a trusted recipient plus
 * a verified award date — never in how the state machine is driven. Two copies of
 * this logic would eventually disagree about which state a failed send lands in,
 * and the consequence of disagreeing is a statutory request that is either sent
 * twice or stranded silently.
 *
 * `SENDING` is a lock, so every exit path here moves the record on. That is the
 * invariant this file exists to hold.
 */

export type FoiaDispatchOutcome =
  /** SES accepted the message; the record is SENT. */
  | { status: 'SENT'; messageId?: string; recipient: string }
  /** The send failed; the record is FAILED or back at AWAITING_APPROVAL. */
  | { status: 'FAILED'; error: string; exhausted: boolean }
  /** Another run owns this send, or the record moved underneath us. */
  | { status: 'SKIPPED'; reason: string };

/**
 * Reads the letter that was approved, falling back to a render.
 *
 * Shared with the handler for the same reason as everything else here: the bytes
 * that go out must not depend on which entry point sent them.
 */
const resolveLetter = async (args: {
  automation: FoiaAutomationDBItem;
  request: Parameters<typeof generateFOIALetter>[0];
  jurisdiction?: 'FEDERAL' | 'STATE';
  state?: string;
}): Promise<string> => {
  const approved = await readFoiaLetterText(args.automation.artifacts).catch((err) => {
    console.warn('[foia-dispatch] could not read the approved letter:', (err as Error).message);
    return null;
  });

  return (
    approved ??
    generateFOIALetter(args.request, {
      ...(args.jurisdiction ? { jurisdiction: args.jurisdiction } : {}),
      ...(args.state ? { state: args.state } : {}),
      // Only reachable when no artifact exists. Never claim bidder status on a
      // fallback render — the evidence for that claim lives at preparation time.
      hasVerifiedSubmission: false,
    })
  );
};

/**
 * Claims, sends, and settles a prepared FOIA request.
 *
 * The caller has already decided the send is authorised. This owns the mechanics:
 * win the lock, call SES, and leave the record in a terminal state whatever
 * happens.
 */
export const dispatchFoiaRequest = async (args: {
  automation: FoiaAutomationDBItem;
  /** Jurisdiction context for the fallback render. */
  jurisdiction?: 'FEDERAL' | 'STATE';
  state?: string;
  /** Copied on the message so the customer holds their own record. */
  ccEmail?: string;
  /** Who is sending — a user id, or 'system' for the unattended path. */
  sentBy: string;
}): Promise<FoiaDispatchOutcome> => {
  const { automation, jurisdiction, state, ccEmail, sentBy } = args;
  const { orgId, projectId, oppId } = automation;

  if (!automation.foiaRequestId) {
    return { status: 'SKIPPED', reason: 'not prepared' };
  }

  // Checked before claiming so an exhausted request does not burn another attempt
  // just to discover it is exhausted.
  if (automation.attemptCount >= FOIA_MAX_SEND_ATTEMPTS) {
    return { status: 'SKIPPED', reason: 'retry cap reached' };
  }

  const request = await getFoiaRequest(orgId, projectId, oppId, automation.foiaRequestId);
  if (!request) {
    return { status: 'SKIPPED', reason: 'request record missing' };
  }

  /**
   * Claim before touching SES.
   *
   * The conditional write is the concurrency control: two runs cannot both win it,
   * so a request cannot be filed twice. A lost race is a no-op rather than an
   * error — it means someone else owns this send.
   *
   * SENT is deliberately absent from the `from` list. A sent statutory request
   * must never be re-sent, however many times this is called.
   */
  const claimed = await transitionFoiaAutomationState({
    orgId,
    projectId,
    oppId,
    from: ['AWAITING_APPROVAL', 'STALLED', 'FAILED'],
    to: 'SENDING',
    patch: { lastAttemptAt: nowIso(), attemptCount: automation.attemptCount + 1 },
    updatedBy: sentBy,
  });

  if (!claimed) {
    return { status: 'SKIPPED', reason: 'already sending or sent' };
  }

  const letter = await resolveLetter({
    automation,
    request,
    ...(jurisdiction ? { jurisdiction } : {}),
    ...(state ? { state } : {}),
  });

  const subject = buildFoiaSubject({ request, isStateRequest: jurisdiction === 'STATE' });

  try {
    const result = await sendFoiaRequest({
      request,
      letter,
      subject,
      artifacts: automation.artifacts as ReadonlyArray<FoiaArtifact> | undefined,
      ...(ccEmail ? { ccEmail } : {}),
    });

    const sentAt = nowIso();

    await transitionFoiaAutomationState({
      orgId,
      projectId,
      oppId,
      from: 'SENDING',
      to: 'SENT',
      patch: { sentAt, sesMessageId: result.messageId, lastError: null },
      updatedBy: sentBy,
    });

    // Best-effort: the automation record already says SENT, and failing to stamp
    // the request must not make a delivered send look undelivered.
    await updateFoiaRequestFields(orgId, projectId, oppId, request.foiaId, { sentAt }).catch(
      (err) =>
        console.warn('[foia-dispatch] could not stamp sentAt:', (err as Error).message),
    );

    await syncOpportunityFoiaMarker(orgId, projectId, oppId, 'SENT');

    await writeFoiaSendAuditLog({
      orgId,
      foiaId: request.foiaId,
      sentBy,
      result: 'success',
      detail: {
        oppId,
        projectId,
        recipient: result.recipient,
        sesMessageId: result.messageId,
        sentAt,
        solicitationNumber: request.solicitationNumber,
        attachments: result.attached,
      },
    });

    return { status: 'SENT', messageId: result.messageId, recipient: result.recipient };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = automation.attemptCount + 1;
    const exhausted = attempts >= FOIA_MAX_SEND_ATTEMPTS;

    /**
     * Release the lock on every failure path.
     *
     * A retryable failure goes back to AWAITING_APPROVAL so the next attempt can
     * claim it; an exhausted one goes to FAILED, which is a visible failure marker
     * rather than a queue entry. Either way the record leaves SENDING — a stranded
     * lock is the one outcome that is worse than a failed send, because it looks
     * like progress while the statutory deadline passes.
     */
    await transitionFoiaAutomationState({
      orgId,
      projectId,
      oppId,
      from: 'SENDING',
      to: exhausted ? 'FAILED' : 'AWAITING_APPROVAL',
      patch: { lastError: message },
      updatedBy: sentBy,
    }).catch((releaseErr) =>
      // Nothing else can release it, so this is the one error worth shouting about.
      console.error(
        '[foia-dispatch] CRITICAL: could not release the SENDING lock for',
        `${orgId}/${projectId}/${oppId}:`,
        (releaseErr as Error).message,
      ),
    );

    if (exhausted) {
      await syncOpportunityFoiaMarker(orgId, projectId, oppId, 'FAILED').catch(() => undefined);
    }

    /**
     * Failed attempts are audited too.
     *
     * An unattended run that tried and failed to file a statutory request is exactly as
     * interesting to an auditor as one that succeeded — more so if it exhausted its
     * retries and the deadline passed with nothing sent.
     */
    await writeFoiaSendAuditLog({
      orgId,
      foiaId: request.foiaId,
      sentBy,
      result: 'failure',
      errorMessage: message,
      detail: { oppId, projectId, attempts, exhausted },
    });

    return { status: 'FAILED', error: message, exhausted };
  }
};
