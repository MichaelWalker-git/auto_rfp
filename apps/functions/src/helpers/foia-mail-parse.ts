/**
 * Extracts readable text from a raw RFC 5322 message.
 *
 * Deliberately not a full MIME implementation. The classifier only needs enough
 * body text to match phrases; a dedicated parser would be another dependency in
 * every Lambda bundle for a job that comes down to "find the text/plain part and
 * un-encode it". Anything this cannot parse degrades to the raw body, which still
 * classifies — agency wording survives quoted-printable and base64 noise well
 * enough for a phrase match, and the correlator works on identifiers that are
 * plain ASCII in practice.
 *
 * Attachment *bytes* are never extracted here. The raw message stays in S3 and is
 * attached by reference, so a malformed part cannot break ingestion.
 */

/** A single MIME part we care about. */
interface ParsedPart {
  contentType: string;
  /** Decoded content for text parts; undefined for anything else. */
  text?: string;
  /** Present when the part looks like a file. */
  fileName?: string;
  /**
   * True when the part is embedded in the message body rather than sent as a file —
   * a signature logo, a social icon, a letterhead graphic.
   */
  isInline?: boolean;
}

export interface ParsedMail {
  /** Best-effort plain-text body, for phrase matching. */
  text: string;
  /**
   * Names of parts the sender actually ATTACHED.
   *
   * Excludes inline images. This is read as evidence that an agency produced
   * records, so a letterhead graphic must not count: in the live corpus 12 of 110
   * messages carried nothing but decorative images and every one was scored
   * RECORDS_RECEIVED, including replies that produced nothing and one that stated
   * the agency held no documents at all.
   *
   * The distinction is reliable in real mail — released records arrive as
   * `Content-Disposition: attachment` with a real filename, while every decoration
   * observed here is `Content-Disposition: inline` with a `Content-ID` (Outlook
   * `image001.png`, `Outlook-em5gwklr`, Gmail `image.png`, GSA `Cloud 4.png`).
   */
  attachmentNames: string[];
  /** Inline part names, kept separately so nothing is silently lost. */
  inlineImageNames: string[];
}

/** Splits headers from body at the first blank line, tolerating CRLF or LF. */
const splitHeadersAndBody = (raw: string): { headers: string; body: string } => {
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match) return { headers: raw, body: '' };

  return {
    headers: raw.slice(0, match.index),
    body: raw.slice(match.index + match[0].length),
  };
};

/**
 * Reads one header value, unfolding continuation lines.
 *
 * Folded headers are the norm in real mail — a long subject wraps, and the
 * continuation is indented. Dropping the continuation would truncate exactly the
 * part the correlator needs, since the solicitation number usually trails the
 * statute name in a subject line.
 *
 * Implemented as a line walk rather than one regex. The regex version used
 * `[\s\S]*?` with the `m` flag, where `$` matches at every line end and the lazy
 * quantifier therefore stopped at the first one — silently returning only the
 * first line of every folded header.
 */
const readHeader = (headers: string, name: string): string | undefined => {
  const lines = headers.split(/\r?\n/);
  const wanted = name.toLowerCase();
  const collected: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== wanted) continue;

    collected.push(line.slice(separator + 1).trim());

    // Continuations are the following lines that begin with whitespace.
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] as string;
      if (!/^[ \t]/.test(next)) break;
      collected.push(next.trim());
    }

    return collected.join(' ').trim();
  }

  return undefined;
};

/**
 * Decodes quoted-printable.
 *
 * Soft line breaks (`=` at end of line) join, and `=XX` becomes the byte. Decoding
 * through Latin-1 then re-reading as UTF-8 is what makes multi-byte characters
 * survive — agency letters contain em dashes and curly quotes, and a naive
 * `String.fromCharCode` mangles them into mojibake that breaks phrase matching.
 */
const decodeQuotedPrintable = (input: string): string => {
  const joined = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];

  for (let i = 0; i < joined.length; i += 1) {
    const char = joined[i] as string;
    if (char === '=' && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(char.charCodeAt(0) & 0xff);
  }

  return Buffer.from(bytes).toString('utf8');
};

const decodeBase64 = (input: string): string =>
  Buffer.from(input.replace(/\s+/g, ''), 'base64').toString('utf8');

/** Applies the part's declared transfer encoding. */
const decodeBody = (body: string, encoding: string | undefined): string => {
  const normalized = (encoding ?? '').toLowerCase().trim();
  if (normalized === 'quoted-printable') return decodeQuotedPrintable(body);
  if (normalized === 'base64') return decodeBase64(body);
  return body;
};

/** Pulls a filename from Content-Disposition or Content-Type. */
const readFileName = (headers: string): string | undefined => {
  const disposition = readHeader(headers, 'Content-Disposition') ?? '';
  const contentType = readHeader(headers, 'Content-Type') ?? '';
  const source = `${disposition}; ${contentType}`;

  const quoted = /(?:file)?name\s*=\s*"([^"]+)"/i.exec(source);
  if (quoted?.[1]) return quoted[1].trim();

  const bare = /(?:file)?name\s*=\s*([^;\s]+)/i.exec(source);
  return bare?.[1]?.trim();
};

/**
 * Whether a named part is embedded in the body rather than attached.
 *
 * Either signal is sufficient, because real senders disagree about which they set:
 * an explicit `Content-Disposition: inline`, or the presence of a `Content-ID` (how
 * an HTML body references an embedded image via `cid:`). Requiring both would miss
 * senders that omit one.
 *
 * A part with `Content-Disposition: attachment` is never inline, even if it also
 * carries a Content-ID — the sender's explicit intent wins. That is what keeps a
 * genuinely released record classified correctly; the real released records in this
 * corpus carry both a Content-ID and an `attachment` disposition.
 */
const isInlinePart = (headers: string): boolean => {
  const disposition = (readHeader(headers, 'Content-Disposition') ?? '').toLowerCase();
  if (/\battachment\b/.test(disposition)) return false;

  return /\binline\b/.test(disposition) || !!readHeader(headers, 'Content-ID');
};

/**
 * Strips tags from HTML so a text-free message still yields matchable words.
 *
 * Script and style content is removed first — otherwise CSS and JS tokens end up
 * in the haystack, where they can only create spurious matches.
 */
const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

/** Recursively walks a message or part, collecting text and attachment names. */
const walkPart = (raw: string, depth: number): ParsedPart[] => {
  // Bound recursion: a hostile or malformed message must not be able to make
  // ingestion spin. Real procurement mail nests two or three levels at most.
  if (depth > 10) return [];

  const { headers, body } = splitHeadersAndBody(raw);
  const rawContentType = readHeader(headers, 'Content-Type') ?? 'text/plain';
  // Compared case-insensitively, but the boundary must be read from the ORIGINAL:
  // boundaries are case-sensitive, so lowercasing turns "BOUND1" into "bound1" and
  // the delimiter never matches — every multipart message then reads as one blob
  // with raw base64 attachment bytes in the classification haystack.
  const contentType = rawContentType.toLowerCase();
  const encoding = readHeader(headers, 'Content-Transfer-Encoding');
  const fileName = readFileName(headers);

  const boundaryMatch = /boundary\s*=\s*"?([^";\r\n]+)"?/i.exec(rawContentType);
  if (contentType.startsWith('multipart/') && boundaryMatch?.[1]) {
    const boundary = boundaryMatch[1];
    // Split on the boundary delimiter; the preamble and epilogue fall away.
    const segments = body.split(new RegExp(`\r?\n?--${escapeRegExp(boundary)}(?:--)?\r?\n?`));
    return segments.slice(1, -1).flatMap((segment) => walkPart(segment, depth + 1));
  }

  if (fileName) {
    return [{ contentType, fileName, isInline: isInlinePart(headers) }];
  }

  if (contentType.startsWith('text/html')) {
    return [{ contentType, text: htmlToText(decodeBody(body, encoding)) }];
  }

  if (contentType.startsWith('text/')) {
    return [{ contentType, text: decodeBody(body, encoding) }];
  }

  return [{ contentType }];
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extracts body text and attachment names from a raw message.
 *
 * Prefers text/plain over text/html when both exist (the usual alternative pair),
 * because the plain part is what the sender wrote rather than a rendering of it.
 * Falls back to the raw body if nothing parses, so classification always has
 * something to work with.
 */
export const parseRawMail = (raw: string): ParsedMail => {
  let parts: ParsedPart[] = [];
  try {
    parts = walkPart(raw, 0);
  } catch {
    // A parse failure must not lose the message. The raw body still classifies.
    parts = [];
  }

  const plain = parts.filter((p) => p.contentType.startsWith('text/plain') && p.text);
  const html = parts.filter((p) => p.contentType.startsWith('text/html') && p.text);
  const chosen = plain.length > 0 ? plain : html;

  const text =
    chosen.map((p) => p.text ?? '').join('\n').trim() || splitHeadersAndBody(raw).body.trim();

  const named = parts.filter(
    (p): p is ParsedPart & { fileName: string } => !!p.fileName && p.fileName.length > 0,
  );

  const attachmentNames = named.filter((p) => !p.isInline).map((p) => p.fileName);
  const inlineImageNames = named.filter((p) => p.isInline).map((p) => p.fileName);

  return { text, attachmentNames, inlineImageNames };
};

/** Reads a single header from a raw message, for callers that need one directly. */
export const readMailHeader = (raw: string, name: string): string | undefined =>
  readHeader(splitHeadersAndBody(raw).headers, name);

/**
 * Where our own quoted text begins in a forwarded or replied thread.
 *
 * Agencies quote the original request in full, so a reply body contains both the
 * agency's few new lines and our entire letter below them. Classifying the two
 * together is the single most productive source of bugs in this pipeline: our
 * letter's wording has been read as an agency announcement three separate times
 * (an award notice, a `DENIED` outcome, and — in seven live messages — an agency
 * reply booked as our own outgoing request). Patching individual phrasings does not
 * fix that, because the text genuinely says what the pattern matches; it is
 * attributed to the wrong author.
 *
 * Two markers, both taken from real mail in this mailbox:
 *   - a `From:` line naming us (Outlook and Gmail both emit these, sometimes
 *     `*From:*` with markdown emphasis, sometimes `>`-quoted)
 *   - an `On <date> <us> wrote:` attribution, which **wraps across lines** in real
 *     Gmail output and contains a narrow no-break space (U+202F) before "AM"
 *
 * Only a marker naming US is a cut point. A marker naming the agency is not: a
 * forwarded thread often *opens* with `----- Forwarded message -----` / `From:
 * <agency>`, so cutting at the first marker of any kind would discard the agency's
 * words entirely — the opposite of the intent. Two real messages
 * (`i3o2h82ak04i`, `615sciteu2kj`) have a separator at offset 0 for exactly this
 * reason, and one nests three authors deep.
 */
const OUR_DOMAIN_PATTERN = /(?:horustech\.dev|@horustech\b)/i;
const FROM_LINE_PATTERN = /^[ \t>]*\*?From:\*?[ \t]*(.{0,160})$/gim;
/** `On <anything, possibly wrapped> wrote:` — the Gmail/Outlook attribution line. */
const WROTE_ATTRIBUTION_PATTERN = /\bOn\b[\s\S]{5,200}?\bwrote:/gi;

/**
 * Returns only the text attributable to the most recent author who is not us.
 *
 * Falls back to the whole body when no marker names us, which is the right default
 * for both a genuine outbound letter (all of it is ours, and the outbound rules are
 * meant to match) and a plain agency message with nothing quoted.
 *
 * `isOurs` is injected rather than hardcoded so the caller decides what "ours"
 * means — in practice the monitored mailbox's own domain.
 */
export const stripQuotedReply = (
  body: string,
  isOurs: (text: string) => boolean = (text) => OUR_DOMAIN_PATTERN.test(text),
): string => {
  const cuts: number[] = [];

  for (const match of body.matchAll(FROM_LINE_PATTERN)) {
    if (isOurs(match[1] ?? '')) cuts.push(match.index ?? 0);
  }
  for (const match of body.matchAll(WROTE_ATTRIBUTION_PATTERN)) {
    if (isOurs(match[0])) cuts.push(match.index ?? 0);
  }

  if (cuts.length === 0) return body;

  const earliest = Math.min(...cuts);
  // A cut at the very start would leave nothing to classify; prefer the full body
  // over an empty haystack.
  return earliest > 0 ? body.slice(0, earliest) : body;
};
