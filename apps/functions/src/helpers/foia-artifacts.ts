import type { FoiaArtifact } from '@auto-rfp/core';

import type { DBFOIARequestItem } from '@/types/project-outcome';
import { nowIso } from '@/helpers/date';
import { requireEnv } from '@/helpers/env';
import { getFileBufferFromS3, uploadToS3 } from '@/helpers/s3';

/**
 * Persists the exact artifacts of a FOIA request to S3.
 *
 * Today the manual flow regenerates the letter on every view and stores nothing,
 * so there is no record of what was actually sent. For an automated request that
 * is not acceptable: the sent text is the evidence of a statutory filing, and it
 * has to be reproducible verbatim months later when the agency responds.
 *
 * Key convention: `{orgId}/{projectId}/{oppId}/foia/{foiaId}/<file>`
 * DOCUMENTS_BUCKET already has grantReadWrite on the shared Lambda role, so no
 * new IAM is required for the API-domain handlers.
 */

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

/** Builds the S3 key prefix for one FOIA request's artifacts. */
export const buildFoiaArtifactPrefix = (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  foiaId: string;
}): string => `${args.orgId}/${args.projectId}/${args.oppId}/foia/${args.foiaId}`;

/**
 * Filename-safe slug for the solicitation number used in artifact names.
 *
 * Collapses runs of dots as well as non-alphanumerics: solicitation numbers come
 * from a third-party feed, and a value like `../../etc/passwd` would otherwise
 * keep its `..` segments and let the artifact key escape its intended prefix.
 */
const slugForFilename = (value: string | undefined): string => {
  const cleaned = (value ?? 'request')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // Any run of dots becomes a single dot, so `..` can never be a path segment.
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'request';
};

/**
 * Writes the letter text to S3 and returns its artifact record.
 *
 * Plain text is the canonical artifact: it is what actually goes in the email
 * body, it needs no rendering dependency, and it can never fail for reasons
 * unrelated to the request itself.
 */
export const persistFoiaLetterText = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  request: DBFOIARequestItem;
  letter: string;
}): Promise<FoiaArtifact> => {
  const { orgId, projectId, oppId, request, letter } = args;

  const prefix = buildFoiaArtifactPrefix({ orgId, projectId, oppId, foiaId: request.foiaId });
  const fileName = `FOIA_Request_${slugForFilename(request.solicitationNumber)}.txt`;
  const s3Key = `${prefix}/${fileName}`;

  await uploadToS3(DOCUMENTS_BUCKET, s3Key, letter, 'text/plain; charset=utf-8');

  return {
    kind: 'LETTER_TXT',
    s3Key,
    fileName,
    contentType: 'text/plain; charset=utf-8',
    sizeBytes: Buffer.byteLength(letter, 'utf8'),
    createdAt: nowIso(),
  };
};

/**
 * Reads back the letter text that was persisted at preparation time.
 *
 * This is what makes "approve" mean something. Re-rendering the letter at send
 * time would transmit whatever the template produces *now*, which is not
 * necessarily what the approver read: the letter's content depends on
 * `hasVerifiedSubmission`, award-date provenance, org name, requester contact and
 * the state-law lookup, and any of those can change between preparation and
 * sending. A template edit or a corrected org record would silently alter a
 * statutory filing after a human signed off on different words.
 *
 * Returns null when no text artifact exists — the caller decides whether that is
 * fatal. It is not always: a request prepared before artifacts were persisted has
 * nothing to read back, and refusing to send it would be worse than re-rendering.
 */
export const readFoiaLetterText = async (
  artifacts: readonly FoiaArtifact[] | undefined,
): Promise<string | null> => {
  const textArtifact = artifacts?.find((a) => a.kind === 'LETTER_TXT');
  if (!textArtifact) return null;

  const buffer = await getFileBufferFromS3(DOCUMENTS_BUCKET, textArtifact.s3Key);
  const text = buffer.toString('utf8');

  // An empty object is a failed upload, not an empty letter. Treat it as absent so
  // the caller falls back rather than sending a blank statutory request.
  return text.trim().length > 0 ? text : null;
};

/**
 * Escapes text for safe interpolation into an HTML document.
 *
 * Every field here originates from a solicitation feed or user input, so it is
 * untrusted as far as the PDF renderer is concerned.
 */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Wraps the plain-text letter in minimal print-oriented HTML. */
export const buildLetterHtml = (letter: string): string =>
  `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(
    letter,
  )}</div>`;

/**
 * Renders the letter to PDF and writes it to S3.
 *
 * Deliberately separate from `persistFoiaLetterText` and always best-effort:
 * `htmlToPdfBuffer` launches headless Chromium, which needs ~1.5GB of memory and
 * a slow cold start. That cost has no place in the nightly reconciler that walks
 * every org, so the import is dynamic (keeping Chromium out of the bundle unless
 * this path actually runs) and a failure degrades to text-only rather than
 * failing the request.
 *
 * @returns the artifact record, or null if rendering failed.
 */
export const persistFoiaLetterPdf = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  request: DBFOIARequestItem;
  letter: string;
}): Promise<FoiaArtifact | null> => {
  const { orgId, projectId, oppId, request, letter } = args;

  try {
    const { htmlToPdfBuffer } = await import('@/helpers/export-pdf');

    const pdf = await htmlToPdfBuffer(buildLetterHtml(letter), {
      title: `FOIA Request — ${request.solicitationNumber ?? ''}`,
      pageSize: 'letter',
    });

    const prefix = buildFoiaArtifactPrefix({ orgId, projectId, oppId, foiaId: request.foiaId });
    const fileName = `FOIA_Request_${slugForFilename(request.solicitationNumber)}.pdf`;
    const s3Key = `${prefix}/${fileName}`;

    await uploadToS3(DOCUMENTS_BUCKET, s3Key, pdf, 'application/pdf');

    return {
      kind: 'LETTER_PDF',
      s3Key,
      fileName,
      contentType: 'application/pdf',
      sizeBytes: pdf.byteLength,
      createdAt: nowIso(),
    };
  } catch (err) {
    // Never block a filing on a rendering dependency.
    console.warn(
      '[foia-artifacts] PDF render failed, continuing with text only:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
};

/**
 * Strips CR, LF and other control characters from a value bound for a mail header.
 *
 * This is not defensive boilerplate — the injection path is real. A header value
 * containing a newline ends the current header and starts a new one, letting an
 * attacker add `Bcc:` recipients or replace the body of a letter we are about to
 * file with a government agency.
 *
 * The inputs genuinely are untrusted: `agencyFOIAEmail` can arrive from tier 2 of
 * the recipient resolver, i.e. `opportunity.contactEmail`, which is typed
 * `z.string().nullish()` with no `.email()` constraint and is populated straight
 * from a third-party solicitation feed. `contractTitle` (which becomes the
 * subject) comes from the same place. `deriveFoiaRequest` also builds its record
 * directly rather than through `FOIARequestItemSchema`, so no Zod parse
 * intervenes.
 *
 * Folding whitespace is collapsed rather than rejected so an otherwise valid
 * title with a stray tab still produces a sendable draft.
 */
const sanitizeHeaderValue = (value: string): string =>
  value
    // Drop CR/LF outright — this is the injection vector.
    .replace(/[\r\n]+/g, ' ')
    // Drop remaining C0/C1 control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

/**
 * Builds an RFC-822 `.eml` the user can open in their own mail client.
 *
 * Mirrors the `X-Unsent: 1` trick already used by
 * handlers/proposal-submission/submit-proposal.ts: the file opens as a ready-to-
 * send draft, which gives the customer a copy of the filing in their own mailbox
 * regardless of how it was transmitted.
 *
 * Every interpolated header value is sanitized — see {@link sanitizeHeaderValue}.
 * The body is not, because it sits after the header/body separator where a
 * newline is just a newline.
 */
export const buildFoiaEml = (args: {
  request: DBFOIARequestItem;
  letter: string;
  subject: string;
}): string => {
  const { request, letter, subject } = args;

  return [
    `To: ${sanitizeHeaderValue(request.agencyFOIAEmail)}`,
    `From: ${sanitizeHeaderValue(request.requesterName)} <${sanitizeHeaderValue(request.requesterEmail)}>`,
    `Reply-To: ${sanitizeHeaderValue(request.requesterEmail)}`,
    `Subject: ${sanitizeHeaderValue(subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    letter,
  ].join('\r\n');
};

/** Writes the `.eml` draft to S3 and returns its artifact record. */
export const persistFoiaEml = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  request: DBFOIARequestItem;
  letter: string;
  subject: string;
}): Promise<FoiaArtifact | null> => {
  const { orgId, projectId, oppId, request, letter, subject } = args;

  try {
    const eml = buildFoiaEml({ request, letter, subject });

    const prefix = buildFoiaArtifactPrefix({ orgId, projectId, oppId, foiaId: request.foiaId });
    const fileName = `FOIA_Request_${slugForFilename(request.solicitationNumber)}.eml`;
    const s3Key = `${prefix}/${fileName}`;

    await uploadToS3(DOCUMENTS_BUCKET, s3Key, eml, 'message/rfc822');

    return {
      kind: 'EML',
      s3Key,
      fileName,
      contentType: 'message/rfc822',
      sizeBytes: Buffer.byteLength(eml, 'utf8'),
      createdAt: nowIso(),
    };
  } catch (err) {
    console.warn(
      '[foia-artifacts] .eml write failed:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
};

/** Standard subject line, shared by the `.eml` draft and the eventual SES send. */
export const buildFoiaSubject = (args: {
  request: DBFOIARequestItem;
  isStateRequest: boolean;
}): string => {
  const noun = args.isStateRequest ? 'Public Records Request' : 'FOIA Request';
  const parts = [
    args.request.solicitationNumber ? `Solicitation No. ${args.request.solicitationNumber}` : null,
    args.request.contractTitle,
  ].filter(Boolean);

  return `${noun} — ${parts.join(', ')}`;
};
