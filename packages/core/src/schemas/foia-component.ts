import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants';

/**
 * A mirror of the FOIA.gov agency-component directory.
 *
 * Source: https://api.foia.gov/api/agency_components (614 components as of
 * seeding). Mirrored into DynamoDB rather than called live so the recipient
 * resolver makes no network call on the hot path and produces identical results
 * on every replay — a scheduled job that picks a different legal recipient
 * depending on an upstream API's mood is not acceptable.
 *
 * The unused `FOIAAgencyInfoSchema` in ./foia was specced for this and never
 * built; this is the realised version, shaped to the API's actual fields.
 */

/**
 * How an agency component expects to receive requests.
 *
 * Restores a concept from the original FOIA design (`FOIASubmissionMethodSchema`)
 * that email-only thinking dropped: 29% of active components publish a portal
 * but no email, and 23% publish neither.
 */
export const FoiaSubmissionMethodSchema = z.enum(['EMAIL', 'PORTAL', 'MAIL', 'FAX', 'UNKNOWN']);
export type FoiaSubmissionMethod = z.infer<typeof FoiaSubmissionMethodSchema>;

/** The structured mailing address FOIA.gov returns. */
export const FoiaComponentAddressSchema = z.object({
  addressLine1: z.string().nullish(),
  addressLine2: z.string().nullish(),
  addressLine3: z.string().nullish(),
  locality: z.string().nullish(),
  administrativeArea: z.string().nullish(),
  postalCode: z.string().nullish(),
  countryCode: z.string().nullish(),
});
export type FoiaComponentAddress = z.infer<typeof FoiaComponentAddressSchema>;

/** Renders a structured address into the single line the letter template expects. */
export const formatFoiaComponentAddress = (
  address: FoiaComponentAddress | null | undefined,
): string | undefined => {
  if (!address) return undefined;

  const street = [address.addressLine1, address.addressLine2, address.addressLine3]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);

  const cityLine = [address.locality?.trim(), address.administrativeArea?.trim()]
    .filter((part): part is string => !!part)
    .join(', ');

  const tail = [cityLine, address.postalCode?.trim()]
    .filter((part): part is string => !!part)
    .join(' ');

  const all = [...street, tail].filter((part) => part.length > 0);
  return all.length > 0 ? all.join(', ') : undefined;
};

// ─── 1. Create request ────────────────────────────────────────────────────────

/**
 * One component as written by the seeder. Not a user-facing DTO — there is no
 * REST endpoint that creates these; only the scheduled seeder does.
 */
export const FoiaComponentCreateRequestSchema = z.object({
  /** FOIA.gov UUID — stable across seeds, so it is the natural id. */
  componentId: z.string().min(1),
  title: z.string().min(1),
  abbreviation: z.string().default(''),
  /** Parent agency UUID from `relationships.agency`. */
  agencyId: z.string().nullish(),
  /**
   * FOIA.gov marks 206 of 614 components inactive. An inactive component's
   * mailbox may be decommissioned, so these must never be an auto-send target.
   */
  isActive: z.boolean().default(true),
  /** Usually 0 or 1 entries; 2 components publish two addresses. */
  emails: z.array(z.string()).default([]),
  submissionAddress: FoiaComponentAddressSchema.nullish(),
  submissionWebUrl: z.string().nullish(),
  submissionFax: z.string().nullish(),
  telephone: z.string().nullish(),
  /**
   * FOIA.gov's own field: "email" or "api". NOTE this describes how FOIA.gov's
   * request portal integrates with the agency — NOT whether the agency accepts
   * email. Army/Navy/Air Force/State are all "api" and all publish a working
   * FOIA mailbox, so this must not be used to suppress an email send.
   */
  portalSubmissionFormat: z.string().nullish(),
  isCentralized: z.boolean().nullish(),
  /** When this row was last refreshed from FOIA.gov. */
  fetchedAt: z.string().datetime({ offset: true }),
});
export type FoiaComponentCreateRequest = z.infer<typeof FoiaComponentCreateRequestSchema>;

// ─── 2. Update request ────────────────────────────────────────────────────────

export const FoiaComponentUpdateRequestSchema = FoiaComponentCreateRequestSchema
  .partial()
  .omit({ componentId: true });
export type FoiaComponentUpdateRequest = z.infer<typeof FoiaComponentUpdateRequestSchema>;

// ─── 3. Item ──────────────────────────────────────────────────────────────────

export const FoiaComponentItemSchema = FoiaComponentCreateRequestSchema.extend({
  /** Normalized title, the exact-match lookup key. */
  normalizedTitle: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
});
export type FoiaComponentItem = z.infer<typeof FoiaComponentItemSchema>;

// ─── 4. DB item ───────────────────────────────────────────────────────────────

export const FoiaComponentDBItemSchema = FoiaComponentItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});
export type FoiaComponentDBItem = z.infer<typeof FoiaComponentDBItemSchema>;

// ─── 5. List item ─────────────────────────────────────────────────────────────

/** Shape the agency-picker UI needs — enough to choose, nothing more. */
export const FoiaComponentListItemSchema = z.object({
  componentId: z.string(),
  title: z.string(),
  abbreviation: z.string().optional(),
  isActive: z.boolean().optional(),
  /** Whether this component can be emailed, for the picker's badge. */
  acceptsEmail: z.boolean().optional(),
  submissionWebUrl: z.string().nullish(),
});
export type FoiaComponentListItem = z.infer<typeof FoiaComponentListItemSchema>;

// ─── Derived helpers ──────────────────────────────────────────────────────────

/** The address to send to, or undefined when the component cannot be emailed. */
export const getFoiaComponentEmail = (
  component: Pick<FoiaComponentItem, 'emails' | 'isActive'>,
): string | undefined => {
  // An inactive component's mailbox may no longer exist. Refuse rather than
  // send a statutory request into a decommissioned inbox.
  if (component.isActive === false) return undefined;
  const first = component.emails.find((e) => e.trim().length > 0);
  return first?.trim();
};

/**
 * How this component should be contacted, in descending preference.
 *
 * Email first when available — it is the only channel software can complete
 * unattended. Otherwise a portal or postal address for a human to use.
 */
export const resolveFoiaSubmissionMethod = (
  component: Pick<
    FoiaComponentItem,
    'emails' | 'isActive' | 'submissionWebUrl' | 'submissionAddress' | 'submissionFax'
  >,
): FoiaSubmissionMethod => {
  if (getFoiaComponentEmail(component)) return 'EMAIL';
  if (component.submissionWebUrl?.trim()) return 'PORTAL';
  if (formatFoiaComponentAddress(component.submissionAddress)) return 'MAIL';
  if (component.submissionFax?.trim()) return 'FAX';
  return 'UNKNOWN';
};

// ─── Matching ─────────────────────────────────────────────────────────────────

/**
 * Which rule produced a match. Recorded so an audit can answer "why did this
 * letter go there", and so the UI can explain itself.
 */
export const FoiaMatchTierSchema = z.enum([
  /** Trailing "(ABBR)" resolved to exactly one component (HigherGov's format). */
  'ABBREVIATION',
  /** A hierarchy segment matched a component title exactly (SAM's dot-path). */
  'HIERARCHY_SEGMENT',
  /** The whole string matched a component title exactly. */
  'EXACT_TITLE',
]);
export type FoiaMatchTier = z.infer<typeof FoiaMatchTierSchema>;

/** Why the matcher declined to answer. Every one of these means "ask a human". */
export const FoiaMatchRefusalSchema = z.enum([
  'EMPTY_INPUT',
  /** No rule produced a hit. The common case for leaf offices. */
  'NO_MATCH',
  /** The abbreviation maps to several components — e.g. OIG maps to 22. */
  'ABBREVIATION_AMBIGUOUS',
  /** Several components share this title. */
  'TITLE_AMBIGUOUS',
]);
export type FoiaMatchRefusal = z.infer<typeof FoiaMatchRefusalSchema>;

/**
 * Normalizes an agency name for exact comparison.
 *
 * Every transformation here is a spelling equivalence — none of them widens what
 * can match, which is what keeps false positives impossible. Deliberately does
 * NOT stem, drop words, or do partial matching: an approximate agency match
 * sends a legal records request to the wrong government office.
 */
export const normalizeAgencyTitle = (value: string): string => {
  let s = (value ?? '').toUpperCase();

  // Spell out the ampersand before punctuation stripping removes it.
  s = s.replace(/&/g, ' AND ');

  // Common feed abbreviations. Punctuation is stripped FIRST so the
  // dotted and undotted spellings ("U.S." / "US") reduce to the same tokens —
  // matching on the dotted form directly used to swallow the following space
  // and produce "USCOAST GUARD".
  s = s.replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  s = s.replace(/\bDEPT\b/g, 'DEPARTMENT');

  // "U.S." became "U S" above; fold it and "USA" to "US".
  //
  // The lookahead is load-bearing: `\bU S A?\b` would let the optional A match
  // nothing while the word boundary still consumed the following space, turning
  // "U.S. Coast Guard" into "USCOAST GUARD". Longest form first.
  s = s.replace(/\bU S A(?=\s|$)/g, 'US');
  s = s.replace(/\bU S(?=\s|$)/g, 'US');
  s = s.replace(/\bUSA\b/g, 'US');

  s = s.replace(/\s+/g, ' ').trim();

  // Feeds invert the department name: "STATE, DEPARTMENT OF".
  const inverted = /^(.*?) DEPARTMENT OF$/.exec(s);
  if (inverted?.[1]) s = `DEPARTMENT OF ${inverted[1]}`;

  return s;
};

/**
 * The lookup surface the matcher needs, so it stays pure and testable.
 * Implementations return how many components share a key, which is what lets
 * the matcher refuse on ambiguity without loading every candidate.
 */
export interface FoiaComponentLookup {
  byNormalizedTitle: (normalized: string) => { componentId: string; count: number } | undefined;
  byAbbreviation: (abbreviation: string) => { componentId: string; count: number } | undefined;
}

export type FoiaMatchResult =
  | { matched: true; componentId: string; tier: FoiaMatchTier }
  | { matched: false; refusal: FoiaMatchRefusal };

/** Pulls a trailing "(ABBR)" — HigherGov formats agencies as "Name (ABBR)". */
const extractTrailingAbbreviation = (value: string): { abbr: string; head: string } | undefined => {
  const m = /\(([A-Za-z0-9][A-Za-z0-9\-.]{1,14})\)\s*$/.exec(value.trim());
  if (!m?.[1]) return undefined;
  return { abbr: m[1].toUpperCase().replace(/[^A-Z0-9]/g, ''), head: value.slice(0, m.index) };
};

/**
 * Maps a solicitation's `organizationName` to a FOIA.gov component.
 *
 * Handles the three shapes the feeds produce:
 *   SAM        "DEPT OF DEFENSE.DEPT OF THE ARMY.AMC.ACC.MICC.W6QM MICC-FT SAM HOUSTON"
 *   HigherGov  "Defense Logistics Agency (DLA)" — or a bare leaf office
 *   DIBBS      "Department of the Air Force"
 *
 * Refuses rather than guesses. A refusal costs one click from a user who then
 * teaches the system permanently; a false positive mails a statutory request to
 * the wrong agency, which nothing downstream can detect.
 */
export const matchFoiaComponent = (
  organizationName: string | null | undefined,
  lookup: FoiaComponentLookup,
): FoiaMatchResult => {
  const raw = (organizationName ?? '').trim();
  if (!raw) return { matched: false, refusal: 'EMPTY_INPUT' };

  // ── Tier 1: an explicit abbreviation is the strongest signal available.
  // 536 of 614 abbreviations are unique; the rest must refuse.
  const trailing = extractTrailingAbbreviation(raw);
  if (trailing) {
    const hit = lookup.byAbbreviation(trailing.abbr);
    if (hit?.count === 1) {
      return { matched: true, componentId: hit.componentId, tier: 'ABBREVIATION' };
    }
    if (hit && hit.count > 1) {
      return { matched: false, refusal: 'ABBREVIATION_AMBIGUOUS' };
    }
  }

  // Strip the "(ABBR)" suffix before title matching so "Name (ABBR)" can still
  // match on its name.
  const body = trailing ? trailing.head.trim() : raw;

  // ── Tier 2: SAM's dot-delimited hierarchy, root first.
  //
  // Root-first is the safety property. The last segment is a local field office
  // ("W6QM MICC-FT SAM HOUSTON") that is not a FOIA component and whose words
  // collide with unrelated offices elsewhere in the country; the first segment is
  // the department that actually answers FOIA requests.
  const segments = body.split('.').map((s) => s.trim()).filter((s) => s.length > 0);

  if (segments.length > 1) {
    for (const segment of segments) {
      const hit = lookup.byNormalizedTitle(normalizeAgencyTitle(segment));
      if (hit?.count === 1) {
        return { matched: true, componentId: hit.componentId, tier: 'HIERARCHY_SEGMENT' };
      }
      if (hit && hit.count > 1) {
        return { matched: false, refusal: 'TITLE_AMBIGUOUS' };
      }
    }
    return { matched: false, refusal: 'NO_MATCH' };
  }

  // ── Tier 3: the whole string as a title.
  const hit = lookup.byNormalizedTitle(normalizeAgencyTitle(body));
  if (hit?.count === 1) {
    return { matched: true, componentId: hit.componentId, tier: 'EXACT_TITLE' };
  }
  if (hit && hit.count > 1) {
    return { matched: false, refusal: 'TITLE_AMBIGUOUS' };
  }

  return { matched: false, refusal: 'NO_MATCH' };
};

/**
 * Builds an in-memory lookup from a component list.
 *
 * Used by the seeder's self-check and by tests. The runtime resolver uses
 * DynamoDB pointer rows instead, so it never loads all 614 components.
 */
export const buildFoiaComponentLookup = (
  components: ReadonlyArray<Pick<FoiaComponentItem, 'componentId' | 'title' | 'abbreviation'>>,
): FoiaComponentLookup => {
  const titles = new Map<string, string[]>();
  const abbrs = new Map<string, string[]>();

  for (const c of components) {
    const t = normalizeAgencyTitle(c.title);
    if (t) titles.set(t, [...(titles.get(t) ?? []), c.componentId]);

    const a = (c.abbreviation ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (a) abbrs.set(a, [...(abbrs.get(a) ?? []), c.componentId]);
  }

  const pick = (m: Map<string, string[]>) => (key: string) => {
    const ids = m.get(key);
    if (!ids || ids.length === 0) return undefined;
    return { componentId: ids[0]!, count: ids.length };
  };

  return { byNormalizedTitle: pick(titles), byAbbreviation: pick(abbrs) };
};
