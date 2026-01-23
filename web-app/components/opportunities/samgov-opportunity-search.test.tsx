import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock dependencies before importing component
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(() => ({
    get: jest.fn(() => null),
  })),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: jest.fn(() => ({
    toast: jest.fn(),
  })),
}));

jest.mock('@/lib/hooks/use-opportunities', () => ({
  useSearchOpportunities: jest.fn(() => ({
    data: null,
    isMutating: false,
    error: null,
    trigger: jest.fn(),
  })),
}));

jest.mock('@/lib/hooks/use-import-solicitation', () => ({
  useImportSolicitation: jest.fn(() => ({
    trigger: jest.fn(),
    isMutating: false,
  })),
}));

jest.mock('@/context/project-context', () => ({
  useProjectContext: jest.fn(() => ({
    projects: [],
  })),
}));

// Mock child components to simplify testing
jest.mock('./samgov-filters', () => ({
  SamGovFilters: ({ value, onChange, activeFilterCount }: any) => (
    <div data-testid="samgov-filters">
      <span data-testid="active-filter-count">{activeFilterCount}</span>
      <input
        data-testid="rdlfrom-input"
        type="text"
        value={value.rdlfrom || ''}
        onChange={(e) =>
          onChange({ ...value, rdlfrom: e.target.value })
        }
      />
    </div>
  ),
}));

jest.mock('./samgov-opportunity-list', () => ({
  SamGovOpportunityList: ({ data }: any) => (
    <div data-testid="opportunity-list">
      <span data-testid="opportunity-count">
        {data?.opportunities?.length ?? 0}
      </span>
    </div>
  ),
}));

jest.mock('@/components/samgov/import-solicitation-dialog', () => ({
  ImportSolicitationDialog: () => null,
}));

import SamGovOpportunitySearchPage from './samgov-opportunity-search';
import { useSearchOpportunities } from '@/lib/hooks/use-opportunities';

describe('SamGovOpportunitySearchPage', () => {
  const mockTrigger = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useSearchOpportunities as jest.Mock).mockReturnValue({
      data: null,
      isMutating: false,
      error: null,
      trigger: mockTrigger,
    });
  });

  describe('rdlfrom filter (response deadline from)', () => {
    it('initializes rdlfrom with a default date in initial state', () => {
      render(<SamGovOpportunitySearchPage orgId="test-org-id" />);

      const rdlfromInput = screen.getByTestId('rdlfrom-input') as HTMLInputElement;
      // rdlfrom is initialized to today's date by defaultDateRange (YYYY-MM-DD format)
      expect(rdlfromInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('includes rdlfrom in active filter count when set', () => {
      render(<SamGovOpportunitySearchPage orgId="test-org-id" />);

      // Initially 1 active filter (rdlfrom is set by default)
      expect(screen.getByTestId('active-filter-count')).toHaveTextContent('1');
    });

    it('displays all opportunities returned from API (server-side filtering)', async () => {
      const mockData = {
        opportunities: [
          {
            noticeId: 'opp-1',
            title: 'Opportunity 1',
            responseDeadLine: '2025-02-14T00:00:00.000Z',
          },
          {
            noticeId: 'opp-2',
            title: 'Opportunity 2',
            responseDeadLine: '2025-02-07T00:00:00.000Z',
          },
        ],
        totalRecords: 2,
        limit: 25,
        offset: 0,
      };

      (useSearchOpportunities as jest.Mock).mockReturnValue({
        data: mockData,
        isMutating: false,
        error: null,
        trigger: mockTrigger,
      });

      render(<SamGovOpportunitySearchPage orgId="test-org-id" />);

      // Shows all opportunities returned from API (filtering is server-side)
      expect(screen.getByTestId('opportunity-count')).toHaveTextContent('2');
    });

    it('shows opportunities with null deadlines from API response', async () => {
      const mockData = {
        opportunities: [
          {
            noticeId: 'opp-1',
            title: 'Opportunity with deadline',
            responseDeadLine: '2025-02-01T00:00:00.000Z',
          },
          {
            noticeId: 'opp-2',
            title: 'Opportunity without deadline',
            responseDeadLine: null,
          },
        ],
        totalRecords: 2,
        limit: 25,
        offset: 0,
      };

      (useSearchOpportunities as jest.Mock).mockReturnValue({
        data: mockData,
        isMutating: false,
        error: null,
        trigger: mockTrigger,
      });

      render(<SamGovOpportunitySearchPage orgId="test-org-id" />);

      // Shows all opportunities from API response
      expect(screen.getByTestId('opportunity-count')).toHaveTextContent('2');
    });

    it('updates rdlfrom when changed', async () => {
      render(<SamGovOpportunitySearchPage orgId="test-org-id" />);

      const rdlfromInput = screen.getByTestId('rdlfrom-input');
      fireEvent.change(rdlfromInput, { target: { value: '2025-03-01' } });

      expect(rdlfromInput).toHaveValue('2025-03-01');
    });
  });
});
