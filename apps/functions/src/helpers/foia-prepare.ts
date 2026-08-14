import type {
  FoiaArtifact,
  FoiaAutomationDBItem,
  FoiaRecipientSource,
  FoiaSettingsItem,
  OpportunityDBItem,
} from '@auto-rfp/core';
import { isTrustedFoiaRecipientSource, isVerifiedAwardDateProvenance } from '@auto-rfp/core';

import type { DBFOIARequestItem } from '@/types/project-outcome';
import { FOIA_REQUEST_PK } from '@/constants/organization';
import { putItem } from '@/helpers/db';
import { buildFoiaRequestSk } from '@/helpers/foia';
import {
  buildFoiaSubject,
  persistFoiaEml,
  persistFoiaLetterText,
} from '@/helpers/foia-artifacts';
import type { UnkeyedFoiaRequest } from '@/helpers/foia-derive';
import { deriveFoiaRequest } from '@/helpers/foia-derive';
import { generateFOIALetter } from '@/helpers/foia-letter';
import { buildNotification, sendNotification } from '@/helpers/send-notification';
import { getOrgMembers } from '@/helpers/user';
import { FOIA_BLOCKED_REASON_LABELS } from '@auto-rfp/core';

/**
 * Turns a due FOIA automation into a prepared, reviewable request.
 *
 * Everything up to the point of transmission happens here: resolve the
 * recipient, derive the twelve letter fields, render the letter, and persist the
 * artifacts. What it deliberately does NOT do is send — the send path owns that,
 * behind the approval gate.
 *
 * Kept out of the scanner so the reconciler stays a decision loop and this stays
 * a unit-testable composition step.
 */

export type PrepareOutcome =
  | {
      status: 'PREPARED';
      /**
       * Keyed on a real run (this is the record read back from the write) and
       * unkeyed on a dry run, where nothing was written.
       *
       * The union is deliberate rather than a convenience: declaring this as
       * always-keyed is what pressured `deriveFoiaRequest` into seeding
       * `partition_key: ''`, and those placeholders then overwrote the real keys
       * inside `putItem`. No consumer reads the keys off this field — verified by
       * grep across the repo — so the weaker type costs nothing.
       */
      request: DBFOIARequestItem | UnkeyedFoiaRequest;
      letter: string;
      artifacts: FoiaArtifact[];
      /**
       * Whether this request may be transmitted without a human click.
       *
       * True only when the recipient came from a trusted source AND the org has
       * enabled `autoSendTrusted`. The scanner uses this to choose between
       * SENDING and AWAITING_APPROVAL.
       */
      autoSendEligible: boolean;
      /** Which resolution tier supplied the address, for the audit trail. */
      recipientSource?: FoiaRecipientSource;
    }
  | {
      status: 'BLOCKED';
      blockedReason: NonNullable<FoiaAutomationDBItem['blockedReason']>;
      missingFields?: string[];
      recipientCandidates?: FoiaAutomationDBItem['recipientCandidates'];
      webPortalUrl?: string;
    };

/**
 * Notifies the org that a FOIA needs human input before it can proceed.
 *
 * Best-effort: a notification failure must never turn a recoverable block into a
 * lost filing, since the marker on the opportunity is the durable signal.
 */
const notifyBlocked = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  opportunityTitle: string;
  blockedReason: NonNullable<FoiaAutomationDBItem['blockedReason']>;
}): Promise<void> => {
  const { orgId, projectId, oppId, opportunityTitle, blockedReason } = args;

  try {
    const members = await getOrgMembers(orgId);
    if (members.length === 0) return;

    await sendNotification(
      buildNotification(
        'FOIA_BLOCKED',
        'FOIA request needs your input',
        `The automatic FOIA request for "${opportunityTitle}" cannot proceed: ${FOIA_BLOCKED_REASON_LABELS[blockedReason]}`,
        {
          orgId,
          projectId,
          entityId: oppId,
          recipientUserIds: members.map((m) => m.userId),
          recipientEmails: members.map((m) => m.email),
          link: `/organizations/${orgId}/projects/${projectId}/opportunities/${oppId}`,
        },
      ),
    );
  } catch (err) {
    console.warn(
      `[foia-prepare] blocked notification failed for ${oppId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
};

/**
 * Composes and persists a FOIA request for one opportunity.
 *
 * @returns PREPARED with the stored request and its artifacts, or BLOCKED with a
 *          reason precise enough for the UI to ask the right question.
 */
export const prepareFoiaRequest = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  opportunity: OpportunityDBItem;
  settings: FoiaSettingsItem;
  /** Compose and report without writing anything. */
  dryRun?: boolean;
  /** Skip the solicitation text scan (dry runs and tests). */
  skipDocumentScan?: boolean;
}): Promise<PrepareOutcome> => {
  const { orgId, projectId, oppId, opportunity, settings, dryRun, skipDocumentScan } = args;

  const derived = await deriveFoiaRequest({
    orgId,
    projectId,
    oppId,
    opportunity,
    settings,
    skipDocumentScan,
  });

  if (!derived.request) {
    const blockedReason = derived.blockedReason ?? 'NEEDS_RECIPIENT';

    if (!dryRun) {
      await notifyBlocked({
        orgId,
        projectId,
        oppId,
        opportunityTitle: opportunity.title ?? oppId,
        blockedReason,
      });
    }

    return {
      status: 'BLOCKED',
      blockedReason,
      missingFields: derived.missingFields,
      recipientCandidates: derived.recipientCandidates,
      webPortalUrl: derived.webPortalUrl,
    };
  }

  const request = derived.request;

  // The letter is framed by the jurisdiction recorded on the opportunity, so a
  // state contract cites that state's records law rather than federal FOIA.
  const letter = generateFOIALetter(request, {
    jurisdiction: opportunity.jurisdiction,
    state: opportunity.state ?? undefined,
    hasVerifiedSubmission: derived.hasVerifiedSubmission,
  });

  /**
   * Auto-send requires a trusted recipient, the org opting in, AND an award date
   * we can stand behind.
   *
   * The three are separate on purpose. Trust is a property of where the address
   * came from. The flag is a deployment-readiness gate (the sending domain must
   * pass DMARC at .gov/.mil first). Provenance is about the letter's content: an
   * unverified date means we do not know an award happened, and filing a records
   * request before award is routinely denied as premature — so the letter still
   * goes out with the hedged wording, but only once a human has looked at it.
   */
  const autoSendEligible =
    settings.autoSendTrusted === true &&
    isTrustedFoiaRecipientSource(derived.recipientSource) &&
    isVerifiedAwardDateProvenance(request.awardDateProvenance);

  if (dryRun) {
    return {
      status: 'PREPARED',
      request,
      letter,
      artifacts: [],
      autoSendEligible,
      recipientSource: derived.recipientSource,
    };
  }

  // Persist the request first: the artifacts reference its foiaId, and a stored
  // request with missing artifacts is recoverable while the reverse is not.
  const stored = await putItem<DBFOIARequestItem>(
    FOIA_REQUEST_PK,
    buildFoiaRequestSk(orgId, projectId, oppId, request.foiaId),
    request,
    false,
  );

  const subject = buildFoiaSubject({
    request: stored,
    isStateRequest: opportunity.jurisdiction === 'STATE',
  });

  // Text is the canonical artifact and must succeed; the .eml is a convenience
  // copy for the customer's own mailbox and is allowed to fail.
  const letterArtifact = await persistFoiaLetterText({
    orgId,
    projectId,
    oppId,
    request: stored,
    letter,
  });

  const emlArtifact = await persistFoiaEml({
    orgId,
    projectId,
    oppId,
    request: stored,
    letter,
    subject,
  });

  const artifacts = [letterArtifact, emlArtifact].filter(
    (artifact): artifact is FoiaArtifact => artifact !== null,
  );

  return {
    status: 'PREPARED',
    request: stored,
    letter,
    artifacts,
    autoSendEligible,
    recipientSource: derived.recipientSource,
  };
};
