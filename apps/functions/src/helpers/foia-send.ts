import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';

import type { FoiaArtifact } from '@auto-rfp/core';

import type { DBFOIARequestItem } from '@/types/project-outcome';
import { getFileBufferFromS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';

/**
 * Transmits a composed FOIA request to an agency.
 *
 * Raw (MIME) rather than simple send, for three reasons the simple API cannot
 * do: attaching the PDF rendition, setting Reply-To to the customer so the
 * agency's reply reaches them rather than us, and naming a configuration set so
 * bounces are captured.
 *
 * Deliverability notes, verified against live DNS rather than assumed:
 *  - `horustech.dev` has SES Easy DKIM verified and signing (d=horustech.dev),
 *    which aligns strictly with a From: @horustech.dev and satisfies the domain's
 *    `adkim=s`. DMARC needs only one aligned mechanism, so SPF failing is fine
 *    and the SPF record does not need editing — a real consideration, since that
 *    record carries all of the company's Google Workspace mail.
 *  - Every recipient tested (army.mil, navy.mil, state.gov, gsa.gov) publishes
 *    DMARC `p=reject`, so unauthenticated mail would be discarded silently.
 */

const ses = new SESClient({});

const SES_FROM_EMAIL = requireEnv('SES_FROM_EMAIL');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
/** Optional: when set, bounces and complaints are routed to the handler. */
const FOIA_CONFIGURATION_SET = process.env['FOIA_SES_CONFIGURATION_SET'];

/**
 * Strips CR/LF and control characters from a mail header value.
 *
 * The same injection guard as the `.eml` builder, and reachable the same way:
 * `agencyFOIAEmail` can originate from `opportunity.contactEmail`, typed
 * `z.string().nullish()` with no `.email()` constraint, straight from a
 * third-party solicitation feed. A newline here could forge a Bcc on a letter
 * being filed with a government agency.
 */
const sanitizeHeaderValue = (value: string): string =>
  value
    .replace(/[\r\n]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** Encodes a header value that may contain non-ASCII, per RFC 2047. */
const encodeHeaderWord = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

/** Splits base64 into 76-character lines, as MIME requires. */
const wrapBase64 = (b64: string): string => b64.replace(/(.{76})/g, '$1\r\n');

export interface FoiaSendResult {
  messageId: string;
  /** The address actually transmitted to, after sanitisation. */
  recipient: string;
  /** Artifacts attached to the message. */
  attached: string[];
}

/**
 * Builds the raw MIME message.
 *
 * Exported for testing — asserting on the assembled MIME is the only way to
 * verify header safety and attachment structure without sending mail.
 */
export const buildFoiaMimeMessage = (args: {
  request: DBFOIARequestItem;
  letter: string;
  subject: string;
  /** Copies the customer so they hold a record of the filing. */
  ccEmail?: string;
  attachments?: ReadonlyArray<{ fileName: string; contentType: string; content: Buffer }>;
}): string => {
  const { request, letter, subject, ccEmail, attachments = [] } = args;

  // Deterministic boundary: Date.now()/Math.random() would make the output
  // untestable, and uniqueness only has to hold within one message.
  const boundary = `----=_FOIA_${request.foiaId.replace(/[^A-Za-z0-9]/g, '')}`;

  const requesterName = sanitizeHeaderValue(request.requesterName);
  const requesterEmail = sanitizeHeaderValue(request.requesterEmail);

  const headers = [
    `From: ${encodeHeaderWord(`${requesterName} (${sanitizeHeaderValue(request.companyName)}) via AutoRFP`)} <${SES_FROM_EMAIL}>`,
    `To: ${sanitizeHeaderValue(request.agencyFOIAEmail)}`,
    // The agency's reply must reach the customer, not our no-reply mailbox.
    `Reply-To: ${requesterEmail}`,
    ...(ccEmail ? [`Cc: ${sanitizeHeaderValue(ccEmail)}`] : []),
    `Subject: ${encodeHeaderWord(sanitizeHeaderValue(subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  const parts: string[] = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    letter,
  ];

  for (const attachment of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${sanitizeHeaderValue(attachment.fileName)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${sanitizeHeaderValue(attachment.fileName)}"`,
      '',
      wrapBase64(attachment.content.toString('base64')),
    );
  }

  parts.push(`--${boundary}--`);

  return [...headers, '', ...parts].join('\r\n');
};

/**
 * Sends the request, attaching the PDF rendition when one was persisted.
 *
 * Throws on failure so the caller can record FAILED and retry — a send that
 * silently no-ops would leave the request looking transmitted.
 */
export const sendFoiaRequest = async (args: {
  request: DBFOIARequestItem;
  letter: string;
  subject: string;
  artifacts?: ReadonlyArray<FoiaArtifact>;
  ccEmail?: string;
  /** Assemble the message and return without calling SES. */
  dryRun?: boolean;
}): Promise<FoiaSendResult> => {
  const { request, letter, subject, artifacts = [], ccEmail, dryRun } = args;

  const recipient = sanitizeHeaderValue(request.agencyFOIAEmail);
  if (!recipient) throw new Error('FOIA request has no agency email to send to');

  // Attach the PDF when it rendered. Its absence is expected rather than
  // exceptional — PDF generation is best-effort because it needs Chromium — so
  // the letter text in the body always carries the request regardless.
  const attachments: Array<{ fileName: string; contentType: string; content: Buffer }> = [];
  const pdf = artifacts.find((a) => a.kind === 'LETTER_PDF');

  if (pdf) {
    try {
      attachments.push({
        fileName: pdf.fileName,
        contentType: pdf.contentType,
        content: await getFileBufferFromS3(DOCUMENTS_BUCKET, pdf.s3Key),
      });
    } catch (err) {
      console.warn(
        `[foia-send] could not attach ${pdf.s3Key}, sending text only:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const raw = buildFoiaMimeMessage({ request, letter, subject, ccEmail, attachments });

  if (dryRun) {
    console.log(`[foia-send] dry run — would send ${raw.length} bytes to ${recipient}`);
    return { messageId: 'dry-run', recipient, attached: attachments.map((a) => a.fileName) };
  }

  const res = await ses.send(
    new SendRawEmailCommand({
      Source: SES_FROM_EMAIL,
      Destinations: [recipient, ...(ccEmail ? [sanitizeHeaderValue(ccEmail)] : [])],
      RawMessage: { Data: Buffer.from(raw, 'utf8') },
      // Without this, bounces are discarded and a rejected statutory request
      // looks identical to a delivered one.
      ...(FOIA_CONFIGURATION_SET ? { ConfigurationSetName: FOIA_CONFIGURATION_SET } : {}),
    }),
  );

  if (!res.MessageId) throw new Error('SES accepted the send but returned no MessageId');

  return { messageId: res.MessageId, recipient, attached: attachments.map((a) => a.fileName) };
};
