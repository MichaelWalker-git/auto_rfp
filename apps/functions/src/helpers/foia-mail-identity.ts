/**
 * Who "we" are, for a message arriving in a monitored mailbox.
 *
 * The authorship rules in this pipeline all reduce to one question: is this span of
 * text one of OUR addresses, or the agency's? `stripQuotedReply` cuts a thread at
 * the first attribution naming us; `hasGovernmentAuthorInThread` stops scanning
 * quoted `From:` lines at the first one naming us. Both were answering that question
 * with a hardcoded `/horustech\.dev|@horustech\b/` regex, which is correct for the
 * one org enabled today and silently wrong for every other tenant — no cut point is
 * found, the whole body stays in the authorship haystack, and the entire root-cause
 * authorship fix does nothing. Measured: a reply quoting our letter beneath
 * `From: procurement@othercorp.com` still classified OUR_OWN_REQUEST/HIGH off the
 * quoted text.
 *
 * This module is the one place the question is answered, and it is answered with a
 * VALUE (a set of hosts we own) rather than an injectable predicate. The previous
 * seam was an optional parameter with a correct-looking default that 100% of callers
 * accepted, so nothing ever failed loudly — optionality is what preserved the bug.
 * Every consumer below now takes a required identity, and the type system is what
 * guarantees the next call site is threaded.
 *
 * Deliberately dependency-free. `foia-mail-parse` imports nothing at all and
 * `foia-mail-classify` imports only `foia-mail-parse`; putting this factory in
 * `foia-settings.ts` would drag `@/helpers/db` and the DynamoDB client into the
 * parse module's import graph and into the read-only replay harness.
 */

/**
 * Hosts whose mail is ours, for one resolved tenant.
 *
 * A plain interface rather than a Zod schema: nothing here is persisted or crosses
 * the wire, so the "all domain types from Zod" rule (which governs the 5-type stored
 * entity pattern) does not apply. This follows the precedent of the other behavioural
 * value types in this pipeline — `ParsedMail`, `ClassifiedMail`, `InboundMailFields`,
 * `MailIngestResult`, `CorrelationCandidate`.
 */
export interface MonitoredMailboxIdentity {
  /**
   * Lowercased hosts we own, matched subdomain-inclusive DOWNWARD only.
   *
   * Never empty: `buildMailboxIdentity` always includes `VENDOR_OWNED_HOSTS`.
   */
  readonly ownedHosts: readonly string[];
}

/**
 * The platform's own sending identity, which franks EVERY tenant's outbound letter.
 *
 * `foia-send.ts` builds `From: <requester> (<company>) via AutoRFP <${SES_FROM_EMAIL}>`
 * with `Reply-To` set to the customer, and `SES_FROM_EMAIL` is a single vendor address
 * (`noreply@horustech.dev`) for every tenant. So when an agency quotes our letter back,
 * the quoted `From:` line names THIS host — not the tenant's `scrapeMailbox` host. A
 * tenant at `foia@acme.com` that owned only `acme.com` would fail to recognise its own
 * letter, which is strictly worse than the hardcoded regex it replaced.
 *
 * PRECONDITION, stated because it is not obvious and will not always hold: this is
 * correct only because AutoRFP sends all outbound mail from one vendor domain. If
 * per-tenant sending domains are ever added, this constant becomes a stale entry that
 * makes every tenant "own" the old vendor domain, and it must be replaced by the
 * tenant's actual sending host rather than extended.
 *
 * Read from a constant rather than `process.env['SES_FROM_EMAIL']` on purpose. That
 * variable is NOT in `FoiaInboundStack`'s Lambda environment, so an env-derived source
 * would be inert here; and `foia-send.ts` reads it via `requireEnv` at module load, so
 * importing that helper into the ingestion path would crash the Lambda on cold start.
 */
const VENDOR_OWNED_HOSTS: readonly string[] = ['horustech.dev'];

/**
 * A `local@host` pair, capturing the host.
 *
 * The host class deliberately forbids a leading or trailing `.`/`-`, so a truncated
 * or malformed address yields the longest well-formed host it can and nothing else.
 */
const ADDRESS_SOURCE = '[^\\s<>@,;:"()[\\]]+@([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)';

/**
 * Two regexes over one source, rather than one shared `/g` regex, because sharing it
 * is a live bug and not a style preference. `hostOf` needs `exec` (first address only)
 * and `mentionsOurAddress` needs `matchAll` (every address) — and `String.matchAll`
 * COPIES `lastIndex` from the regex it is handed, so an `exec` on a `/g` regex
 * anywhere leaves a cursor that makes the next `matchAll` silently skip the start of
 * its input. Measured while writing this: with one shared regex,
 * `buildMailboxIdentity` (which calls `hostOf`) left `lastIndex` at 15, and the next
 * `mentionsOurAddress('a@mail.acme.com', …)` scanned from offset 15 and returned
 * false. Non-global for the single read, global for the scan.
 */
const SINGLE_ADDRESS_PATTERN = new RegExp(ADDRESS_SOURCE);
const ALL_ADDRESSES_PATTERN = new RegExp(ADDRESS_SOURCE, 'g');

/** The host of a single address, or undefined when there is not one to read. */
const hostOf = (address: string | null | undefined): string | undefined => {
  if (!address) return undefined;
  const host = SINGLE_ADDRESS_PATTERN.exec(address)?.[1];
  return host ? host.toLowerCase() : undefined;
};

/**
 * Whether one host falls under an owned host.
 *
 * Subdomain-inclusive DOWNWARD only: owning `horustech.dev` also owns
 * `inbox.horustech.dev`, while owning `inbox.horustech.dev` never owns
 * `horustech.dev`. That direction is the whole reason the vendor host has to be in
 * the set explicitly — the live org's mailbox is `foia@inbox.horustech.dev`, and the
 * real messages in the corpus carry `proposals@horustech.dev`,
 * `brennen@horustech.dev`, `michael@horustech.dev`. Measured against the 335-message
 * corpus, owning the mailbox host ALONE diverges from current behaviour on 22
 * messages, every one of them losing its cut point (`09fjg22f` 40 -> 7276 chars,
 * `4soe9nen` 40 -> 7848, `615sciteu2kj` 1603 -> 4765) — i.e. silently disabling the
 * authorship fix for the live org.
 *
 * NO LABEL STRIPPING, and no registrable-domain heuristic. Do not "simplify" this
 * into taking the last two labels: the corpus contains real multi-label public
 * suffixes (`sbcusd.k12.ca.us`, `state.sd.us`, `govqa.us`), so for a tenant on a
 * `k12.*.us` mailbox a two-label strip would claim ownership of `ca.us` and cut at
 * every California school district's `From:` line, discarding agency prose wholesale.
 * An explicit owned-host union needs no public-suffix list and no guard.
 */
const ownsHost = (host: string, ownedHosts: readonly string[]): boolean =>
  ownedHosts.some((owned) => host === owned || host.endsWith(`.${owned}`));

/**
 * Builds the identity for a resolved tenant.
 *
 * `scrapeMailbox` is the address the org told us it forwards from — the same value
 * `findOrgByScrapeMailbox` matched the message's recipients against, so by the time
 * this is called the tenant is already attributed.
 *
 * This is the ONE remaining default in the system, and it lives in the function whose
 * whole job is answering "who are we": with no readable mailbox the identity is the
 * vendor hosts alone, which reproduces today's behaviour exactly (measured: 0 of 335
 * decisions differ). `getFoiaSettings` never throws and returns
 * `buildDefaultFoiaSettings`, whose `scrapeMailbox` is nullish, so an org that has not
 * configured one degrades here rather than failing the message.
 */
export const buildMailboxIdentity = (args: {
  scrapeMailbox?: string | null;
}): MonitoredMailboxIdentity => {
  const mailboxHost = hostOf(args.scrapeMailbox);

  return {
    ownedHosts: [...new Set([...(mailboxHost ? [mailboxHost] : []), ...VENDOR_OWNED_HOSTS])],
  };
};

/**
 * Whether a span of text names one of OUR addresses.
 *
 * Requires an actual `local@host`, which is the one respect in which this is LOOSER
 * than the regex it replaces: the old `@horustech\b` arm also matched a bare mention
 * of our name with no address, and a `From:` line long enough to be truncated by
 * `FROM_LINE_PATTERN`'s 160-character capture (`... <noreply@horustech.d`) matched
 * that arm too. Neither shape occurs in the 335-message corpus — 0 bare-brand spans
 * across all quoted `From:` lines — so the corpus diff is empty BY MEASUREMENT, not
 * by construction. Do not upgrade that to "by construction": these two shapes are
 * real off-corpus behaviour changes.
 *
 * Requiring an address is nonetheless the right trade, and a bare-brand arm is
 * actively wrong for a multi-tenant fix: for a tenant at `foia@acme.com` a bare
 * `acme` mention would make `clerk@acme.gov` register as ours and suppress a genuine
 * agency author. The direction of the remaining looseness is also the safe one — a
 * missed stop in `hasGovernmentAuthorInThread` reads a message as agency-authored
 * (FLAGGED / FOIA_RESPONSE) rather than silently filing it as our own.
 */
export const mentionsOurAddress = (
  text: string,
  identity: MonitoredMailboxIdentity,
): boolean => {
  // A fresh regex per call: `matchAll` copies `lastIndex` off the regex it is given,
  // so reusing the module-level global one across calls would carry a cursor from the
  // previous scan and skip the start of this input.
  for (const match of text.matchAll(new RegExp(ALL_ADDRESSES_PATTERN))) {
    if (ownsHost((match[1] ?? '').toLowerCase(), identity.ownedHosts)) return true;
  }
  return false;
};
