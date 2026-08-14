/**
 * Deterministic occurrence expansion for package edits.
 *
 * The model reads the package section-by-section and can miss occurrences of a
 * value (e.g. an email that appears in two different sections) — a recall gap
 * that let "change X everywhere" edit only one of several spots. To fix recall
 * we don't trust the model to find every instance: we take the concrete
 * before→after change the model proposed, extract the literal token that
 * changed, and then scan the WHOLE package deterministically for every
 * occurrence of that token — emitting one guarded proposal per occurrence.
 *
 * The model still decides WHAT to change (it's good at that); the backend
 * guarantees we find every place it occurs (deterministic string scan).
 */

const isWs = (c: string): boolean => /\s/.test(c);

export const normalizeHaystack = (text: string): string => text.replace(/\s+/g, ' ');

/** All start indices of `needle` in `haystack` (non-overlapping). */
const allIndexes = (haystack: string, needle: string): number[] => {
  const out: number[] = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + needle.length);
  }
  return out;
};

/**
 * Grow a window around [start,end) one word at a time (both sides) until the
 * windowed substring occurs exactly once in `text`, or expansion is exhausted.
 * Returns the unique-ish context snippet plus the find token's offset within it.
 */
const uniqueContext = (
  text: string,
  start: number,
  end: number,
): { snippet: string; offsetInSnippet: number } => {
  let lo = start;
  let hi = end;
  const occursOnce = (a: number, b: number): boolean => {
    const sub = text.slice(a, b);
    const first = text.indexOf(sub);
    return first !== -1 && text.indexOf(sub, first + 1) === -1;
  };

  let guard = 0;
  while (!occursOnce(lo, hi) && guard < 60) {
    guard++;
    const prevLo = lo;
    const prevHi = hi;
    // extend left across one word (+ its leading space)
    if (lo > 0) {
      lo--;
      while (lo > 0 && !isWs(text[lo - 1])) lo--;
    }
    // extend right across one word
    if (hi < text.length) {
      while (hi < text.length && isWs(text[hi])) hi++;
      while (hi < text.length && !isWs(text[hi])) hi++;
    }
    if (lo === prevLo && hi === prevHi) break; // can't expand further
  }

  return { snippet: text.slice(lo, hi), offsetInSnippet: start - lo };
};

export interface OccurrenceEdit {
  /** Context-unique verbatim current text (plain). */
  before: string;
  /** Same context with the token replaced at its exact position. */
  after: string;
}

/**
 * Every occurrence of `find` in a document's normalized plain text, each as a
 * context-unique before→after pair (so the guarded apply can locate exactly one
 * spot per proposal).
 */
export const findDocumentOccurrences = (
  plainText: string,
  find: string,
  replace: string,
): OccurrenceEdit[] => {
  const text = normalizeHaystack(plainText);
  const token = normalizeHaystack(find);
  const indexes = allIndexes(text, token);

  return indexes.map((idx) => {
    const { snippet, offsetInSnippet } = uniqueContext(text, idx, idx + token.length);
    const before = snippet;
    const after =
      snippet.slice(0, offsetInSnippet) +
      normalizeHaystack(replace) +
      snippet.slice(offsetInSnippet + token.length);
    return { before: before.trim(), after: after.trim() };
  });
};

/** Replace every occurrence of `find` with `replace` in a form field value. */
export const replaceInFieldValue = (value: string, find: string, replace: string): string =>
  value.split(find).join(replace);

// ─── Regex + anchor matching (pattern-based recall) ──────────────────────────
//
// Literal find/replace only catches a value when every occurrence is the SAME
// string. When the same logical value exists as multiple variants (e.g. two
// different emails for one person after a partial prior edit), we match by SHAPE
// instead: the model supplies a regex (e.g. an email pattern) plus an optional
// `near` anchor (e.g. "Brennen"), and we deterministically find every match whose
// surrounding context contains the anchor. This removes the dependency on the
// model enumerating variants.

/** How many chars on each side of a match to search for the anchor + to build context. */
const ANCHOR_WINDOW = 120;

/** Max chars a single regex match may span — a longer match is almost certainly a runaway pattern. */
const MAX_MATCH_LEN = 200;

/**
 * Compile a model-supplied regex safely, or return null. Guards against:
 *  - invalid syntax
 *  - over-broad patterns (bare `.*`/`.+` or empty) that would match everything
 *  - a length cap (200 chars)
 *  - the COMMON catastrophic-backtracking shapes: nested unbounded quantifiers
 *    ((a+)+, (a*)*, (.+)+), stacked quantifiers (a**), and simple alternation
 *    overlap ((a|a)+, (a|ab)+).
 *
 * This is HEURISTIC, not a complete ReDoS analysis — it can't catch every
 * pathological pattern (Node's RegExp has no execution timeout, and full static
 * ReDoS detection is out of scope). Defense in depth makes a slip low-impact: it
 * runs only in the async worker (off the 29s request path), the pattern is length-
 * capped, and callers bound the scan (`findRegexOccurrences` caps at 5000 matches
 * and drops matches over MAX_MATCH_LEN). So a bad pattern fails/slows ONE proposal
 * run at worst. The pattern is applied with a global flag; case set by the caller.
 */
export const safeCompileRegex = (pattern: string): RegExp | null => {
  const p = (pattern ?? '').trim();
  if (!p || p.length > 200) return null;

  // Reject patterns that would match (nearly) anything — too dangerous for a
  // package-wide replace even behind human review.
  const stripped = p.replace(/\s/g, '');
  if (/^[.^$\\]*(\.[*+])?[.^$\\]*$/.test(stripped)) return null; // e.g. ".*", ".+", "^.*$"

  // Common catastrophic-backtracking shapes (heuristic — see doc above):
  if (/\([^)]*[+*]\)[+*]/.test(p)) return null; // group ending in +/* then quantified: (a+)+
  if (/[+*]{2,}/.test(p)) return null; // stacked quantifiers: "++", "*+", "a**"
  // Quantified alternation whose branches share a prefix — the (a|a)+ / (a|ab)+
  // family. Flag any quantified group that contains a top-level `|`; legitimate
  // find patterns (emails/phones/amounts) don't quantify an alternation group.
  if (/\([^)]*\|[^)]*\)[+*]/.test(p)) return null;

  try {
    // 'g' for all matches. Case is kept as-authored (the caller may lower-case).
    return new RegExp(p, 'g');
  } catch {
    return null;
  }
};

export interface RegexMatch {
  before: string;
  after: string;
  /** The exact substring the regex matched (for dedup / diagnostics). */
  matched: string;
  /** True when a `near` anchor was required and found in the match's window. */
  anchored: boolean;
}

/**
 * Find every regex match in `plainText` and build a context-unique before→after
 * that replaces ONLY the matched span with `replace`. When `near` is provided,
 * `anchored` reflects whether the anchor appears within ANCHOR_WINDOW chars of
 * the match — the caller decides whether to keep unanchored matches (conservative
 * mode drops them).
 */
export const findRegexOccurrences = (
  plainText: string,
  regex: RegExp,
  replace: string,
  near?: string,
): RegexMatch[] => {
  const text = normalizeHaystack(plainText);
  const anchor = (near ?? '').trim().toLowerCase();
  const out: RegexMatch[] = [];
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');

  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(text)) !== null && guard < 5000) {
    guard++;
    const matched = m[0];
    // Skip empty / runaway matches and always advance to avoid infinite loops.
    if (!matched) {
      re.lastIndex++;
      continue;
    }
    if (matched.length > MAX_MATCH_LEN) continue;
    if (matched === replace) continue; // already the target value

    const start = m.index;
    const end = start + matched.length;

    let anchored = true;
    if (anchor) {
      const windowStart = Math.max(0, start - ANCHOR_WINDOW);
      const windowEnd = Math.min(text.length, end + ANCHOR_WINDOW);
      anchored = text.slice(windowStart, windowEnd).toLowerCase().includes(anchor);
    }

    const { snippet, offsetInSnippet } = uniqueContext(text, start, end);
    const before = snippet;
    const after =
      snippet.slice(0, offsetInSnippet) +
      normalizeHaystack(replace) +
      snippet.slice(offsetInSnippet + matched.length);
    out.push({ before: before.trim(), after: after.trim(), matched, anchored });
  }
  return out;
};

/**
 * Find regex matches in a form field value and replace ONLY the in-context ones.
 *
 * Anchoring is per-match, like the document path (`findRegexOccurrences`), so a
 * `near` anchor next to ONE match can't clobber a sibling value that merely
 * shares the field — e.g. value "Primary: alice@x.com  Secondary: bob@x.com"
 * with an email regex and near "Primary" rewrites only alice's address.
 *
 * The field's LABEL is treated as whole-field context: if the anchor lives in
 * the label (e.g. label "VENDOR'S PRIMARY CONTACT — Phone", value
 * "(480) 269-0424", near "Phone"), every match in the value is in-context. A
 * label anchor therefore anchors all matches; otherwise the anchor must appear
 * within `ANCHOR_WINDOW` chars of each individual match.
 *
 * When `near` is set, matches whose context lacks the anchor are left untouched
 * (so `after` reflects only the anchored replacements, and `matchedAny` is false
 * if nothing in-context was replaced).
 */
export const findRegexInFieldValue = (
  value: string,
  regex: RegExp,
  replace: string,
  near?: string,
  label?: string,
): { after: string; anchored: boolean; matchedAny: boolean } => {
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  const anchor = (near ?? '').trim().toLowerCase();
  const labelAnchored = anchor ? (label ?? '').toLowerCase().includes(anchor) : true;

  let result = '';
  let lastEnd = 0;
  let matchedAny = false;

  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(value)) !== null && guard < 5000) {
    guard++;
    const matched = m[0];
    // Skip empty / runaway matches and always advance to avoid infinite loops.
    if (!matched) {
      re.lastIndex++;
      continue;
    }
    if (matched.length > MAX_MATCH_LEN || matched === replace) continue; // leave original text

    const start = m.index;
    const end = start + matched.length;

    // The label anchors the whole field; otherwise the anchor must appear within
    // a window around THIS match, or we leave the match untouched.
    let matchAnchored = labelAnchored;
    if (anchor && !matchAnchored) {
      const windowStart = Math.max(0, start - ANCHOR_WINDOW);
      const windowEnd = Math.min(value.length, end + ANCHOR_WINDOW);
      matchAnchored = value.slice(windowStart, windowEnd).toLowerCase().includes(anchor);
    }
    if (anchor && !matchAnchored) continue; // out of context — keep original text

    result += value.slice(lastEnd, start) + replace;
    lastEnd = end;
    matchedAny = true;
  }
  result += value.slice(lastEnd);

  // With per-match anchoring, any replacement we made was in-context, so a match
  // implies anchored. With no anchor, everything is trivially in-context.
  return { after: result, anchored: anchor ? matchedAny : true, matchedAny };
};
