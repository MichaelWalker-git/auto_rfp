import { describe, it, expect } from 'vitest';
import {
  buildSamGovUrl,
  SamOpportunitySearchResultSchema,
  samSlimToSearchOpportunity,
  LoadSearchOpportunitiesRequestSchema,
  SavedSearchSchema,
} from './index';

describe('buildSamGovUrl', () => {
  it('uses uiLink when SAM returns a usable one', () => {
    expect(
      buildSamGovUrl('https://sam.gov/opp/bc68ead9f19d43a79fb0bda9108ee39a/view', 'notice-1'),
    ).toBe('https://sam.gov/opp/bc68ead9f19d43a79fb0bda9108ee39a/view');
  });

  it('rewrites the retired beta.sam.gov host, which no longer resolves', () => {
    // SAM's own published example still shows this host.
    expect(buildSamGovUrl('https://beta.sam.gov/opp/abc123/view', 'notice-1')).toBe(
      'https://sam.gov/opp/abc123/view',
    );
  });

  it('falls back to noticeId when uiLink is the literal string "null"', () => {
    // Observed in SAM's documented sample response.
    expect(buildSamGovUrl('null', 'notice-1')).toBe('https://sam.gov/opp/notice-1/view');
    expect(buildSamGovUrl('NULL', 'notice-1')).toBe('https://sam.gov/opp/notice-1/view');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
    ['not a URL', 'not-a-url'],
  ])('falls back to noticeId when uiLink is %s', (_label, uiLink) => {
    expect(buildSamGovUrl(uiLink, 'notice-1')).toBe('https://sam.gov/opp/notice-1/view');
  });

  it.each([
    ['an unrelated host', 'https://evil.example.com/opp/abc/view'],
    // A bare endsWith('sam.gov') matches these, and they are registerable.
    ['a lookalike suffix', 'https://evilsam.gov/opp/abc/view'],
    ['another lookalike suffix', 'https://notsam.gov/opp/abc/view'],
    ['sam.gov as a subdomain of an attacker domain', 'https://sam.gov.evil.com/opp/abc/view'],
    // `new URL()` reads everything before the @ as userinfo; the host is evil.com.
    ['sam.gov in the userinfo', 'https://sam.gov@evil.com/opp/abc/view'],
    ['sam.gov only in the query', 'https://evil.com/opp/abc/view?x=sam.gov'],
    ['a javascript: scheme', 'javascript:alert(1)//sam.gov'],
    ['a data: scheme', 'data:text/html,<script>alert(1)</script>'],
  ])('ignores a uiLink with %s', (_label, uiLink) => {
    // Never emit a link to a host SAM does not control.
    expect(buildSamGovUrl(uiLink, 'notice-1')).toBe('https://sam.gov/opp/notice-1/view');
  });

  it.each([
    ['the apex domain', 'https://sam.gov/opp/abc/view'],
    ['a real subdomain', 'https://www.sam.gov/opp/abc/view'],
    ['the api subdomain', 'https://api.sam.gov/opp/abc/view'],
  ])('accepts %s', (_label, uiLink) => {
    expect(buildSamGovUrl(uiLink, 'notice-1')).toBe(uiLink);
  });

  it('accepts a host differing only by case or a trailing dot', () => {
    // "sam.gov." is a valid absolute FQDN and resolves identically.
    expect(buildSamGovUrl('https://SAM.GOV/opp/abc/view', 'notice-1')).toBe(
      'https://sam.gov/opp/abc/view',
    );
    expect(buildSamGovUrl('https://sam.gov./opp/abc/view', 'notice-1')).toBe(
      'https://sam.gov./opp/abc/view',
    );
  });

  it('returns null when there is neither a usable uiLink nor a noticeId', () => {
    expect(buildSamGovUrl(null, null)).toBeNull();
    expect(buildSamGovUrl(undefined, undefined)).toBeNull();
    expect(buildSamGovUrl('null', '  ')).toBeNull();
  });

  it('encodes an unexpected noticeId rather than emitting a broken URL', () => {
    expect(buildSamGovUrl(null, 'a b/c')).toBe('https://sam.gov/opp/a%20b%2Fc/view');
  });
});

describe('SamOpportunitySearchResultSchema', () => {
  it('accepts uiLink, including explicit null', () => {
    expect(SamOpportunitySearchResultSchema.safeParse({ uiLink: 'https://sam.gov/opp/a/view' }).success).toBe(true);
    expect(SamOpportunitySearchResultSchema.safeParse({ uiLink: null }).success).toBe(true);
    expect(SamOpportunitySearchResultSchema.safeParse({}).success).toBe(true);
  });
});

describe('samSlimToSearchOpportunity', () => {
  it('exposes a View source URL, which was previously hardcoded to null', () => {
    const result = samSlimToSearchOpportunity({
      noticeId: 'bc68ead9f19d43a79fb0bda9108ee39a',
      title: 'Bovine IFN Lambda Fc Fusion',
    });

    expect(result.url).toBe('https://sam.gov/opp/bc68ead9f19d43a79fb0bda9108ee39a/view');
  });

  it("prefers SAM's own uiLink over the constructed URL", () => {
    const result = samSlimToSearchOpportunity({
      noticeId: 'notice-1',
      uiLink: 'https://sam.gov/opp/canonical-id/view',
    });

    expect(result.url).toBe('https://sam.gov/opp/canonical-id/view');
  });

  it('leaves url null when the record has no noticeId', () => {
    const result = samSlimToSearchOpportunity({ solicitationNumber: 'SOL-1' });

    expect(result.url).toBeNull();
    expect(result.id).toBe('SOL-1');
  });

  it('still routes a sam.gov description URL to descriptionUrl', () => {
    // Regression guard: `url` and `descriptionUrl` are different fields.
    const result = samSlimToSearchOpportunity({
      noticeId: 'notice-1',
      description: 'https://api.sam.gov/prod/opportunity/v1/noticedesc?noticeid=notice-1',
    });

    expect(result.descriptionUrl).toBe(
      'https://api.sam.gov/prod/opportunity/v1/noticedesc?noticeid=notice-1',
    );
    expect(result.description).toBeNull();
    expect(result.url).toBe('https://sam.gov/opp/notice-1/view');
  });
});

const SEARCH_ID = 'BWr0PdG39B6mX8cG47AQ8';

describe('higherGovSearchId in search criteria', () => {
  it('survives parsing, rather than being stripped', () => {
    const { success, data } = LoadSearchOpportunitiesRequestSchema.safeParse({
      higherGovSearchId: SEARCH_ID,
    });

    expect(success).toBe(true);
    expect(data?.higherGovSearchId).toBe(SEARCH_ID);
  });

  it('survives inside a saved search, which is where it used to be dropped', () => {
    // Saved-search criteria are validated against LoadSearchOpportunitiesRequest-
    // Schema. While the field was missing from it, Zod silently removed the ID on
    // save, so a saved HigherGov search ran as an unfiltered query instead.
    const { success, data } = SavedSearchSchema.safeParse({
      savedSearchId: 'ss-1',
      orgId: 'org-1',
      source: 'HIGHER_GOV',
      name: 'State and Local Contracts',
      criteria: { higherGovSearchId: SEARCH_ID },
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
    });

    expect(success).toBe(true);
    expect(data?.criteria.higherGovSearchId).toBe(SEARCH_ID);
  });

  it('rejects an empty id rather than storing a blank', () => {
    const { success } = LoadSearchOpportunitiesRequestSchema.safeParse({ higherGovSearchId: '' });

    expect(success).toBe(false);
  });

  it('is optional, so criteria for other sources still parse', () => {
    const { success, data } = LoadSearchOpportunitiesRequestSchema.safeParse({ keywords: 'document' });

    expect(success).toBe(true);
    expect(data?.higherGovSearchId).toBeUndefined();
  });
});

describe('SavedSearch.projectId', () => {
  const base = {
    savedSearchId: 'ss-1',
    orgId: 'org-1',
    source: 'HIGHER_GOV' as const,
    name: 'State and Local Contracts',
    criteria: { higherGovSearchId: SEARCH_ID },
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  };

  it('records the originating project so the scheduler imports into it', () => {
    const { success, data } = SavedSearchSchema.safeParse({ ...base, projectId: 'proj-42' });

    expect(success).toBe(true);
    expect(data?.projectId).toBe('proj-42');
  });

  it('is optional — older org-level searches without a project still parse', () => {
    const { success, data } = SavedSearchSchema.safeParse(base);

    expect(success).toBe(true);
    expect(data?.projectId).toBeUndefined();
  });
});
