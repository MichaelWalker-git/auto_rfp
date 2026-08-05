import { render, screen } from '@testing-library/react';
import type { SavedSearch } from '@auto-rfp/core';

import { SavedSearchCard } from '../SavedSearchCard';

const SEARCH_ID = 'BWr0PdG39B6mX8cG47AQ8';

const makeSavedSearch = (over: Partial<SavedSearch> = {}): SavedSearch => ({
  savedSearchId: 'ss-1',
  orgId: 'org-1',
  source: 'HIGHER_GOV',
  name: 'Testing',
  criteria: {},
  frequency: 'DAILY',
  autoImport: false,
  notifyEmails: [],
  isEnabled: true,
  lastRunAt: null,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
  ...over,
});

const renderCard = (savedSearch: SavedSearch) =>
  render(
    <SavedSearchCard
      savedSearch={savedSearch}
      onRun={jest.fn()}
      onDelete={jest.fn()}
      onToggleEnabled={jest.fn()}
    />,
  );

describe('SavedSearchCard subtitle', () => {
  it('shows the HigherGov ID, since the ID is the whole search', () => {
    renderCard(makeSavedSearch({ criteria: { higherGovSearchId: SEARCH_ID } }));

    expect(screen.getByText(new RegExp(SEARCH_ID))).toBeInTheDocument();
  });

  it('flags a HigherGov search saved without an ID', () => {
    // These exist in dev: saved before the ID was persisted, so Zod stripped it.
    // HigherGov has no keyword parameter, so they match everything in their date
    // range — they must not look like a working, filtered search.
    renderCard(makeSavedSearch({ criteria: { postedFrom: '07/06/2026', postedTo: '08/05/2026' } }));

    expect(screen.getByText(/no highergov id saved/i)).toBeInTheDocument();
    expect(screen.queryByText(/all opportunities/i)).not.toBeInTheDocument();
  });

  it('still describes a filterless SAM.gov search as all opportunities', () => {
    // SAM.gov does support keywords, so no filters there is a legitimate choice.
    renderCard(makeSavedSearch({ source: 'SAM_GOV', criteria: {} }));

    expect(screen.getByText(/all opportunities/i)).toBeInTheDocument();
    expect(screen.queryByText(/no highergov id saved/i)).not.toBeInTheDocument();
  });

  it('does not flag a HigherGov search that has other filters', () => {
    renderCard(makeSavedSearch({ criteria: { keywords: 'document processing' } }));

    expect(screen.getByText(/document processing/)).toBeInTheDocument();
    expect(screen.queryByText(/no highergov id saved/i)).not.toBeInTheDocument();
  });
});
