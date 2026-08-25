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
}

export interface ParsedMail {
  /** Best-effort plain-text body, for phrase matching. */
  text: string;
  /** Attachment file names, for recording what the agency sent. */
  attachmentNames: string[];
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
    return [{ contentType, fileName }];
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

  const attachmentNames = parts
    .map((p) => p.fileName)
    .filter((name): name is string => !!name && name.length > 0);

  return { text, attachmentNames };
};

/** Reads a single header from a raw message, for callers that need one directly. */
export const readMailHeader = (raw: string, name: string): string | undefined =>
  readHeader(splitHeadersAndBody(raw).headers, name);
