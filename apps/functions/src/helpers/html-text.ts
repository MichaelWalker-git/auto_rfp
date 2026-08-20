/**
 * Shared HTML → plain-text utilities.
 *
 * We don't ship an HTML parser dependency, so tags are stripped with regex.
 * Entity decoding lives here once — the strip flavors differ per consumer
 * (prompt blobs collapse all whitespace; text exports keep block-level
 * newlines), so only the shared shape is centralized.
 */

/**
 * The single HTML-entity table used by BOTH decoders in the tree:
 * `decodeHtmlEntities` (regex replace) and html-edit's `buildPlainMap` (literal
 * prefix-match with an offset map). Keeping one source means the plain-text
 * `before` produced for a proposal (via `stripHtml → decodeHtmlEntities`) and the
 * plain-text projection an edit is applied against decode the SAME entities — a
 * mismatch here silently drops any edit whose context touches an entity one side
 * doesn't know (e.g. a curly apostrophe or em-dash).
 *
 * Order and semantics match the prior chained-`.replace()` decoder exactly (both
 * decoders apply these sequentially, so `&amp;` stays first as it always has).
 * `ci` marks entities matched case-insensitively (numeric hex + `&nbsp;`); `&#39;`
 * and `&#039;` are both listed as literals.
 */
export interface HtmlEntity {
  entity: string;
  char: string;
  ci?: boolean;
}

export const HTML_ENTITIES: readonly HtmlEntity[] = [
  { entity: '&amp;', char: '&' },
  { entity: '&lt;', char: '<' },
  { entity: '&gt;', char: '>' },
  { entity: '&quot;', char: '"' },
  { entity: '&#039;', char: "'" },
  { entity: '&#39;', char: "'" },
  { entity: '&#x27;', char: "'", ci: true },
  { entity: '&nbsp;', char: ' ', ci: true },
  { entity: '&mdash;', char: '—' },
  { entity: '&ndash;', char: '–' },
  { entity: '&hellip;', char: '…' },
  { entity: '&rsquo;', char: '’' },
  { entity: '&lsquo;', char: '‘' },
  { entity: '&rdquo;', char: '”' },
  { entity: '&ldquo;', char: '“' },
  { entity: '&bull;', char: '•' },
  { entity: '&trade;', char: '™' },
  { entity: '&copy;', char: '©' },
  { entity: '&reg;', char: '®' },
];

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Precompiled once — decodeHtmlEntities is hot (every export/compliance strip).
const ENTITY_REPLACERS = HTML_ENTITIES.map(({ entity, char, ci }) => ({
  re: new RegExp(escapeRegExp(entity), ci ? 'gi' : 'g'),
  char,
}));

/**
 * At raw-HTML offset `p` (where `html[p] === '&'`), return the entity that
 * literally begins there, or undefined. Case-insensitive for `ci` entries so a
 * `&NBSP;` / `&#X27;` decodes exactly as `decodeHtmlEntities` would. Used by
 * html-edit's offset-mapping projection so it stays in lockstep with this table.
 */
export const matchHtmlEntityAt = (html: string, p: number): HtmlEntity | undefined => {
  for (const e of HTML_ENTITIES) {
    const seg = html.slice(p, p + e.entity.length);
    if (e.ci ? seg.toLowerCase() === e.entity : seg === e.entity) return e;
  }
  return undefined;
};

/** Decode common HTML entities to plain text. `&amp;` first, matching every prior in-tree decoder. */
export const decodeHtmlEntities = (text: string): string =>
  ENTITY_REPLACERS.reduce((acc, { re, char }) => acc.replace(re, char), text);

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
