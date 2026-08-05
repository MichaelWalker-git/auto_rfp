import { criteriaToParams, paramsToCriteria, paramsToFormValues } from '../search-criteria-url';

const SEARCH_ID = 'BWr0PdG39B6mX8cG47AQ8';

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
