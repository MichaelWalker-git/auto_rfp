/**
 * Shared text-scanning primitives for the compliance-review checks.
 *
 * The C1–C6 factual-accuracy checks all scan package prose the same way —
 * whitespace-normalize, tokenize, word-boundary match, find dollar amounts — so
 * these live here once instead of being re-declared in every check file.
 */

/** Collapse all runs of whitespace to a single space and trim the ends. */
export const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Escape a string for safe interpolation into a RegExp. */
export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Distinct lowercase words of a string, length-filtered (≥3 chars) — used for
 * partial-overlap matching of multi-word labels/values, where a single common
 * short word ("the", "of") would otherwise match everything.
 */
export const tokens = (s: string): string[] =>
  norm(s)
    .toLowerCase()
    .split(/[^\w]+/)
    .filter((w) => w.length >= 3);

/**
 * Whole-word (word-boundary) presence test. A plain substring `.includes`
 * produced false-positive findings because the identifier acronyms occur INSIDE
 * ordinary words — "being" / "protein" / "ceiling" contain "ein", "cage" is
 * itself a word — so any doc with those words got a spurious inconsistency
 * finding. `\b...\b` requires the token to stand alone.
 *
 * `caseSensitive` matters for the two uses:
 *  - LABEL match → case-sensitive: the federal identifiers (UEI/CAGE/EIN) are
 *    ALWAYS uppercase acronyms in proposal text, so "CAGE" is the label but the
 *    lowercase word "cage" is not — case-sensitivity is what separates them
 *    (word boundaries alone can't).
 *  - VALUE match → case-insensitive: for the "value is absent" check, matching
 *    loosely means we're LESS likely to wrongly report it missing.
 */
export const containsWord = (haystack: string, needle: string, caseSensitive = false): boolean => {
  const n = needle.trim();
  if (!n) return false;
  return new RegExp(`\\b${escapeRegex(n)}\\b`, caseSensitive ? '' : 'i').test(haystack);
};

/**
 * A dollar amount: $1,200,000 / $1.2M / $500K / $3 million.
 *
 * Factory (not a shared const) because the pattern is global (`/g`) and thus
 * carries mutable `lastIndex` state — a single shared instance would leak that
 * state across call sites. Each caller gets a fresh regex.
 */
export const dollarRegex = (): RegExp => /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[KMB]|thousand|million|billion)?/gi;

/**
 * A person-name heuristic: "First Last" or "First M. Last" — two-or-three
 * capitalized tokens. Deliberately loose (the C6c Stage-2 model is the precision
 * gate); used only to decide a chunk plausibly NAMES someone near a role mention,
 * the team analog of `dollarRegex` near a service label. Factory for the same
 * `lastIndex`-leak reason as `dollarRegex`.
 */
export const personNameRegex = (): RegExp =>
  /\b[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+\b/g;
