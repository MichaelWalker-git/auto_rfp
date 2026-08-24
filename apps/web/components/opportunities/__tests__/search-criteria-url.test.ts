import type { SavedSearch } from '@auto-rfp/core';

import {
  criteriaToParams,
  paramsToCriteria,
  paramsToFormValues,
  savedSearchToParams,
} from '../search-criteria-url';

const SEARCH_ID = 'BWr0PdG39B6mX8cG47AQ8';

const makeSavedSearch = (criteria: SavedSearch['criteria']): SavedSearch => ({
  savedSearchId: 'ss-1',
  orgId: 'org-1',
  source: 'HIGHER_GOV',
  name: 'State and Local Contracts',
  criteria,
  frequency: 'DAILY',
  autoImport: false,
  notifyEmails: [],
  isEnabled: true,
  lastRunAt: null,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
});

describe('criteriaToParams', () => {
  it('serializes a HigherGov search id', () => {
    const params = criteriaToParams({ higherGovSearchId: SEARCH_ID });

    expect(params.get('hgId')).toBe(SEARCH_ID);
  });

  it('omits the id when absent', () => {
    expect(criteriaToParams({ keywords: 'document' }).has('hgId')).toBe(false);
  });

  it('keeps the default page size out of the URL', () => {
    expect(criteriaToParams({ keywords: 'a', limit: 25 }).has('limit')).toBe(false);
    expect(criteriaToParams({ keywords: 'a', limit: 50 }).get('limit')).toBe('50');
  });
});

describe('paramsToCriteria', () => {
  it('treats a search id alone as a real search', () => {
    // The guard used to require q/source/naics/setAside/from, so an ID-only
    // search parsed as null and the Saved Searches "Run" button restored nothing.
    const criteria = paramsToCriteria(new URLSearchParams({ hgId: SEARCH_ID }));

    expect(criteria).not.toBeNull();
    expect(criteria?.higherGovSearchId).toBe(SEARCH_ID);
  });

  it('still returns null for a bare page visit', () => {
    expect(paramsToCriteria(new URLSearchParams())).toBeNull();
    expect(paramsToCriteria(new URLSearchParams({ limit: '50' }))).toBeNull();
  });

  it('round-trips an id-only search unchanged', () => {
    const original = { higherGovSearchId: SEARCH_ID, sources: ['HIGHER_GOV' as const], limit: 25 };

    const restored = paramsToCriteria(criteriaToParams(original));

    expect(restored?.higherGovSearchId).toBe(SEARCH_ID);
    expect(restored?.sources).toEqual(['HIGHER_GOV']);
  });

  it('falls back to the default limit for a garbage or non-positive value', () => {
    // A hand-crafted `?limit=abc` used to pass NaN straight to the search API.
    expect(paramsToCriteria(new URLSearchParams({ hgId: SEARCH_ID, limit: 'abc' }))?.limit).toBe(25);
    expect(paramsToCriteria(new URLSearchParams({ hgId: SEARCH_ID, limit: '0' }))?.limit).toBe(25);
    expect(paramsToCriteria(new URLSearchParams({ hgId: SEARCH_ID, limit: '-5' }))?.limit).toBe(25);
    expect(paramsToCriteria(new URLSearchParams({ hgId: SEARCH_ID, limit: '50' }))?.limit).toBe(50);
  });

  it('round-trips an id alongside other filters', () => {
    const original = {
      higherGovSearchId: SEARCH_ID,
      keywords: 'document processing',
      naics: ['541512', '541519'],
      setAsideCode: 'SBA',
      postedFrom: '2026-07-06',
      limit: 25,
    };

    const restored = paramsToCriteria(criteriaToParams(original));

    expect(restored).toMatchObject({
      higherGovSearchId: SEARCH_ID,
      keywords: 'document processing',
      naics: ['541512', '541519'],
      setAsideCode: 'SBA',
      postedFrom: '2026-07-06',
    });
  });
});

describe('legacy source back-compat', () => {
  // The UI now offers SAM.gov and HigherGov only, but `?source=DIBBS` and
  // `?source=all` URLs are still bookmarked and still linked from saved searches.
  // They must degrade to SAM.gov rather than strand the form on an unselectable
  // provider (or, worse, send an unsupported source to the API).
  it.each([
    ['DIBBS', 'DIBBS'],
    ['the legacy "all" mode', 'all'],
    ['an unrecognised value', 'GOVWIN'],
    ['no source at all', null],
  ])('coerces %s to SAM_GOV', (_label, source) => {
    const params = new URLSearchParams({ q: 'radar' });
    if (source !== null) params.set('source', source);

    expect(paramsToFormValues(params)?.source).toBe('SAM_GOV');
    expect(paramsToCriteria(params)?.sources).toEqual(['SAM_GOV']);
  });

  it('still honours HIGHER_GOV', () => {
    const params = new URLSearchParams({ source: 'HIGHER_GOV', hgId: SEARCH_ID });

    expect(paramsToFormValues(params)?.source).toBe('HIGHER_GOV');
    expect(paramsToCriteria(params)?.sources).toEqual(['HIGHER_GOV']);
  });
});

describe('savedSearchToParams', () => {
  it('reopens a stored DIBBS search against SAM.gov', () => {
    // DIBBS is no longer selectable; the saved row still exists in DynamoDB.
    const params = savedSearchToParams({
      ...makeSavedSearch({ keywords: 'bolts' }),
      source: 'DIBBS',
    });

    expect(params.get('source')).toBe('SAM_GOV');
  });

  it('produces a URL the search page can actually parse', () => {
    // The run button used to push `?search=<json>`, which only the older
    // samgov-opportunity-search page reads — so it landed on an empty form.
    const params = savedSearchToParams(makeSavedSearch({ higherGovSearchId: SEARCH_ID }));

    expect(params.get('hgId')).toBe(SEARCH_ID);
    expect(params.has('search')).toBe(false);
    expect(paramsToCriteria(params)).not.toBeNull();
  });

  it('carries the saved search source through', () => {
    const params = savedSearchToParams(makeSavedSearch({ higherGovSearchId: SEARCH_ID }));

    expect(params.get('source')).toBe('HIGHER_GOV');
  });

  it('converts stored MM/dd/yyyy dates to the ISO form the URL uses', () => {
    const params = savedSearchToParams(makeSavedSearch({
      keywords: 'document',
      postedFrom: '07/06/2026',
      postedTo: '08/05/2026',
    }));

    expect(params.get('from')).toBe('2026-07-06');
    expect(params.get('to')).toBe('2026-08-05');
  });

  it('pads single-digit stored dates into valid ISO', () => {
    // A stored `7/6/2026` would otherwise become a non-ISO `2026-7-6`.
    const params = savedSearchToParams(makeSavedSearch({ keywords: 'x', postedFrom: '7/6/2026' }));

    expect(params.get('from')).toBe('2026-07-06');
  });

  it.each([
    ['empty', ''],
    ['already ISO', '2026-07-06'],
    ['not a date', 'garbage'],
    ['missing the year', '07/06'],
  ])('omits a %s stored date rather than emitting a broken one', (_label, postedFrom) => {
    const params = savedSearchToParams(makeSavedSearch({ keywords: 'x', postedFrom }));

    expect(params.has('from')).toBe(false);
  });

  it('restores the calendar day the user picked, not the UTC day', () => {
    // `new Date('2026-07-06')` is UTC midnight, which is the 5th for anyone west
    // of UTC — so the date picker used to show the day before.
    const values = paramsToFormValues(new URLSearchParams({ q: 'x', from: '2026-07-06' }));

    expect(values?.postedFrom?.getFullYear()).toBe(2026);
    expect(values?.postedFrom?.getMonth()).toBe(6); // July, zero-indexed
    expect(values?.postedFrom?.getDate()).toBe(6);
  });

  it('round-trips into criteria the search page can run', () => {
    const criteria = paramsToCriteria(savedSearchToParams(makeSavedSearch({
      higherGovSearchId: SEARCH_ID,
      postedFrom: '07/06/2026',
    })));

    expect(criteria?.higherGovSearchId).toBe(SEARCH_ID);
    expect(criteria?.postedFrom).toBe('2026-07-06');
    expect(criteria?.sources).toEqual(['HIGHER_GOV']);
  });
});

describe('paramsToFormValues', () => {
  it('restores the search id into the form', () => {
    const values = paramsToFormValues(new URLSearchParams({ hgId: SEARCH_ID }));

    expect(values).not.toBeNull();
    expect(values?.higherGovSearchId).toBe(SEARCH_ID);
  });

  it('uses an empty string rather than undefined, since the input is controlled', () => {
    const values = paramsToFormValues(new URLSearchParams({ q: 'document' }));

    expect(values?.higherGovSearchId).toBe('');
  });

  it('returns null for a bare page visit', () => {
    expect(paramsToFormValues(new URLSearchParams())).toBeNull();
  });
});
