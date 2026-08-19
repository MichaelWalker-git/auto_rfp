import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { UpdateFoiaCustomDocumentsSchema } from '@auto-rfp/core';
import type { FoiaArtifact } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getUserId } from '@/helpers/api';
import { getFoiaAutomation, setFoiaAutomationState } from '@/helpers/foia-automation';
import { getFoiaRequest, updateFoiaRequestFields } from '@/helpers/foia';
import {
  buildFoiaSubject,
  persistFoiaEml,
  persistFoiaLetterText,
} from '@/helpers/foia-artifacts';
import { generateFOIALetter } from '@/helpers/foia-letter';
import { getOpportunity } from '@/helpers/opportunity';
import { getSubmissionHistory } from '@/helpers/proposal-submission';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

/**
 * Adds solicitation-specific document requests to a prepared, unsent FOIA request.
 *
 * Why this is its own handler rather than a call to `update-foia-request`:
 * BOTH send paths transmit the PERSISTED letter artifact, not a fresh render
 * (`readFoiaLetterText` in send-foia-request.ts and foia-dispatch.ts). That is
 * deliberate — it guarantees the bytes a human approved are the bytes that go out.
 * The consequence is that patching the DB row alone would update what the UI shows
 * while the agency still received the old letter, and the divergence would be
 * invisible: the reviewer's own preview would show their edit.
 *
 * So an edit to the letter's content MUST re-render and re-persist the artifacts in
 * the same operation. That is the whole reason this handler exists.
 */

/** States where the letter has been composed but not yet transmitted. */
const EDITABLE_STATES = ['AWAITING_APPROVAL', 'FAILED'] as const;

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event) ?? 'system';

  const { success, data, error } = UpdateFoiaCustomDocumentsSchema.safeParse(
    JSON.parse(event.body ?? '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const { orgId, projectId, oppId, customDocumentRequests } = data;

  const automation = await getFoiaAutomation(orgId, projectId, oppId);
  if (!automation) {
    return apiResponse(404, { message: 'No FOIA automation found for this opportunity' });
  }

  /**
   * Refuse once the letter is out of human hands.
   *
   * SENT is the important one: the filing exists, the agency holds a copy, and
   * rewriting our stored artifact afterwards would destroy the evidence of what was
   * actually sent. SENDING is a lock held by an in-flight SES call — editing under
   * it would race the transmission.
   */
  if (!(EDITABLE_STATES as readonly string[]).includes(automation.state)) {
    return apiResponse(409, {
      message: `Cannot edit document requests while the request is ${automation.state}. Only a prepared, unsent request can be edited.`,
    });
  }

  if (!automation.foiaRequestId) {
    return apiResponse(409, { message: 'The FOIA request has not been composed yet' });
  }

  const request = await getFoiaRequest(orgId, projectId, oppId, automation.foiaRequestId);
  if (!request) {
    return apiResponse(404, { message: 'FOIA request record not found' });
  }

  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) {
    return apiResponse(404, { message: 'Opportunity not found' });
  }

  /**
   * Re-derive bidder status rather than trusting the stored letter.
   *
   * The claim "submitted a proposal and was not selected" is a factual assertion to
   * a government agency, and the evidence for it is the submission history — not
   * anything the reviewer typed. Re-deriving keeps the rewritten letter as honest as
   * the original. A lookup failure must read as "no evidence", never as "yes".
   */
  const submissions = await getSubmissionHistory(orgId, projectId, oppId).catch(() => []);
  const hasVerifiedSubmission = submissions.some(
    (s) =>
      typeof s?.submittedAt === 'string' && s.submittedAt.length > 0 && s.status !== 'WITHDRAWN',
  );

  const updatedRequest = { ...request, customDocumentRequests };

  const letter = generateFOIALetter(updatedRequest, {
    ...(opportunity.item.jurisdiction ? { jurisdiction: opportunity.item.jurisdiction } : {}),
    ...(opportunity.item.state ? { state: opportunity.item.state } : {}),
    hasVerifiedSubmission,
    // Re-rendered here, so it must reach the same conclusion the original send did —
    // a win must not be described as not selected for award.
    isAwardee: opportunity.item.status === 'WON',
  });

  const subject = buildFoiaSubject({
    request: updatedRequest,
    isStateRequest: opportunity.item.jurisdiction === 'STATE',
  });

  /**
   * Persist the row first, then the artifacts — the same ordering as
   * `prepareFoiaRequest`, and for the same reason: a stored request whose artifacts
   * lag is recoverable (the next edit or the send's fallback render fixes it), while
   * artifacts that describe a request the table does not have are not.
   */
  await updateFoiaRequestFields(orgId, projectId, oppId, request.foiaId, {
    customDocumentRequests,
  });

  const letterArtifact = await persistFoiaLetterText({
    orgId,
    projectId,
    oppId,
    request: updatedRequest,
    letter,
  });

  const emlArtifact = await persistFoiaEml({
    orgId,
    projectId,
    oppId,
    request: updatedRequest,
    letter,
    subject,
  });

  /**
   * Replace the artifact list rather than appending.
   *
   * `readFoiaLetterText` takes the FIRST artifact of kind LETTER_TXT it finds, so
   * appending a re-rendered letter would leave the stale one ahead of it in the
   * array and the send would transmit the pre-edit text — exactly the bug this
   * handler exists to prevent. The S3 keys are deterministic per foiaId, so the new
   * objects overwrite the old ones anyway; only the list order was ever at risk.
   */
  const artifacts = [letterArtifact, emlArtifact].filter(
    (artifact): artifact is FoiaArtifact => artifact !== null,
  );

  const updated = await setFoiaAutomationState({
    orgId,
    projectId,
    oppId,
    // Unchanged: this is an edit, not a transition. FAILED stays FAILED so the
    // reason a previous send failed is not silently cleared by an unrelated edit.
    state: automation.state,
    patch: { artifacts, updatedBy: userId },
  });

  return apiResponse(200, { automation: updated, letter });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(httpErrorMiddleware()),
);
