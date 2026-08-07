import { describe, it, expect } from 'vitest';
import {
  LoadSearchOpportunitiesRequestSchema,
  SavedSearchSchema,
} from './index';

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
