/**
 * Shared HTML → plain-text utilities.
 *
 * We don't ship an HTML parser dependency, so tags are stripped with regex.
 * Entity decoding lives here once — the strip flavors differ per consumer
 * (prompt blobs collapse all whitespace; text exports keep block-level
 * newlines), so only the shared shape is centralized.
 */

/** Decode common HTML entities to plain text. `&amp;` first, matching every prior in-tree decoder. */
export const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“')
    .replace(/&bull;/g, '•')
    .replace(/&trade;/g, '™')
    .replace(/&copy;/g, '©')
    .replace(/&reg;/g, '®');

/**
 * Strip HTML to a single-line plain-text blob: tags become `tagReplacement`
 * (a space by default, so words don't merge across element boundaries),
 * entities decode, and all whitespace collapses to single spaces.
 */
export const stripHtmlToText = (
  html: string,
  options?: { tagReplacement?: string },
): string =>
  decodeHtmlEntities(html.replace(/<[^>]*>/g, options?.tagReplacement ?? ' '))
    .replace(/\s+/g, ' ')
    .trim();
