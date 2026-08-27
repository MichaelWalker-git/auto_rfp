import { buildMailboxIdentity, mentionsOurAddress } from './foia-mail-identity';

describe('buildMailboxIdentity', () => {
  it('owns the resolved tenant’s mailbox host', () => {
    expect(buildMailboxIdentity({ scrapeMailbox: 'foia@acme.com' }).ownedHosts).toContain(
      'acme.com',
    );
  });

  it('always owns the platform’s own sending host', () => {
    /**
     * `foia-send.ts` franks EVERY tenant's outbound letter with a single vendor
     * `SES_FROM_EMAIL`, so the quoted `From:` line an agency sends back names that host
     * rather than the tenant's. Without this, a tenant at `foia@acme.com` would fail to
     * recognise its own letter — strictly worse than the hardcoded regex this replaced.
     */
    expect(buildMailboxIdentity({ scrapeMailbox: 'foia@acme.com' }).ownedHosts).toContain(
      'horustech.dev',
    );
  });

  it('falls back to the vendor host when no mailbox is configured', () => {
    // `getFoiaSettings` never throws: with no stored row it returns
    // `buildDefaultFoiaSettings`, whose `scrapeMailbox` is nullish. Degrading to
    // today's behaviour is what keeps that org's messages classifying rather than
    // failing.
    for (const mailbox of [undefined, null, '', 'not-an-address', '@', 'foia@']) {
      expect(buildMailboxIdentity({ scrapeMailbox: mailbox }).ownedHosts).toEqual([
        'horustech.dev',
      ]);
    }
  });

  it('does not duplicate the vendor host when the tenant IS the vendor', () => {
    expect(buildMailboxIdentity({ scrapeMailbox: 'foia@horustech.dev' }).ownedHosts).toEqual([
      'horustech.dev',
    ]);
  });

  it('lowercases the host it reads', () => {
    expect(buildMailboxIdentity({ scrapeMailbox: 'FOIA@Acme.COM' }).ownedHosts).toContain(
      'acme.com',
    );
  });
});

describe('mentionsOurAddress', () => {
  const LIVE = buildMailboxIdentity({ scrapeMailbox: 'foia@inbox.horustech.dev' });
  const ACME = buildMailboxIdentity({ scrapeMailbox: 'foia@acme.com' });

  it('matches every one of our real addresses in the live corpus', () => {
    /**
     * The main trap the brief names, pinned. The live org's mailbox is on the SUBDOMAIN
     * `inbox.horustech.dev`, while the real messages carry addresses on the PARENT. An
     * exact-host or mailbox-host-only match would fail on all of these and silently
     * disable the authorship fix for the only enabled tenant — measured on the corpus:
     * 22 of 335 messages lose their cut point (`09fjg22f` 40 -> 7276 chars,
     * `4soe9nen` 40 -> 7848, `615sciteu2kj` 1603 -> 4765).
     */
    for (const address of [
      'proposals@horustech.dev',
      'stevan@horustech.dev',
      'brennen@horustech.dev',
      'michael@horustech.dev',
      'jhoan@horustech.dev',
      'foia@inbox.horustech.dev',
      'Brennen Stones <brennen@horustech.dev>',
      'noreply@horustech.dev',
    ]) {
      expect(mentionsOurAddress(address, LIVE)).toBe(true);
    }
  });

  it('matches a subdomain of an owned host, never its parent', () => {
    // Downward only. Owning `acme.com` owns `mail.acme.com`; owning
    // `inbox.horustech.dev` does NOT own `horustech.dev` — which is precisely why the
    // vendor host is in the owned set explicitly rather than derived by stripping.
    expect(mentionsOurAddress('a@mail.acme.com', ACME)).toBe(true);
    expect(
      mentionsOurAddress('a@horustech.dev', { ownedHosts: ['inbox.horustech.dev'] }),
    ).toBe(false);
  });

  it('does not match a lookalike or a suffix collision', () => {
    for (const address of [
      'clerk@notacme.com',
      'clerk@acme.com.example.gov',
      'clerk@acme.gov',
      'clerk@xacme.com',
    ]) {
      expect(mentionsOurAddress(address, ACME)).toBe(false);
    }
  });

  it('does not match a bare brand mention with no address', () => {
    /**
     * The one respect in which this is LOOSER than the `/@horustech\b/` arm it
     * replaces, stated honestly rather than hidden. 0 such spans exist across all 53
     * quoted `From:` lines in the 335-message corpus, so the corpus diff is empty by
     * MEASUREMENT — not by construction.
     *
     * Requiring a real address is still the right trade for a multi-tenant fix: a
     * bare-brand arm on a tenant at `foia@acme.com` would make `clerk@acme.gov`
     * register as ours and suppress a genuine agency author. And the failure direction
     * here is safe — a missed stop in `hasGovernmentAuthorInThread` reads a message as
     * agency-authored rather than silently filing it as our own.
     */
    expect(mentionsOurAddress('per our call with Horustech last week', LIVE)).toBe(false);
    expect(mentionsOurAddress('see horustech.dev/status for updates', LIVE)).toBe(false);
  });

  it('does not match a host truncated mid-domain', () => {
    /**
     * `FROM_LINE_PATTERN` captures at most 160 characters, so a long display name can
     * cut the address off mid-host. The deleted regex matched `<noreply@horustech.d`
     * as a substring; address extraction does not. Zero occurrences in the corpus, but
     * since the legacy regex is removed with no fallback this is the one shape where
     * behaviour is measurably looser, so it gets an explicit test rather than a silent
     * gap.
     */
    // Sized so the 160th character lands inside `horustech.dev`: the display name is
    // padded to put `<noreply@horustech.d` exactly at the capture boundary.
    const suffix = ' via AutoRFP <noreply@horustech.dev>';
    const displayName = 'Jonathan Christopher Featherstonehaugh-Wallace'.padEnd(
      160 - (suffix.length - '>'.length) + 2,
      '.',
    );
    const full = `${displayName}${suffix}`;

    // Long enough that FROM_LINE_PATTERN's 160-character capture cuts the host in two.
    expect(full.length).toBeGreaterThan(160);
    const captured = full.slice(0, 160);
    expect(captured).toContain('noreply@horustech.d');
    expect(captured).not.toContain('horustech.dev');

    expect(mentionsOurAddress(captured, LIVE)).toBe(false);
    // The untruncated form IS recognised, so the gap is the capture width rather than
    // the predicate.
    expect(mentionsOurAddress(full, LIVE)).toBe(true);
  });

  it('finds our address anywhere in a mixed attribution span', () => {
    // `On ... wrote:` spans are tested whole, and a real one names both parties. Both
    // the old predicate and this one read such a span as ours; the imprecision is
    // pre-existing and unchanged.
    const span =
      'On Mon, Aug 17, 2026 at 10:33 AM Patrick Gallegos <bids@parks.ca.gov> forwarded ' +
      'to brennen@horustech.dev wrote:';

    expect(mentionsOurAddress(span, LIVE)).toBe(true);
  });

  it('is stateless across repeated calls', () => {
    // The address pattern carries /g; a leaked `lastIndex` would make the second call
    // disagree with the first.
    const span = 'From: Brennen Stones <brennen@horustech.dev>';

    expect(mentionsOurAddress(span, LIVE)).toBe(true);
    expect(mentionsOurAddress(span, LIVE)).toBe(true);
    expect(mentionsOurAddress(span, LIVE)).toBe(true);
  });
});
