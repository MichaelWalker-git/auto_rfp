import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
        data-testid="min-days-input"
        type="number"
        value={value.minDaysUntilDue || ''}
        onChange={(e) =>
          onChange({ ...value, minDaysUntilDue: parseInt(e.target.value) || 0 })
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

  describe('minDaysUntilDue filter', () => {
    it('initializes minDaysUntilDue to 0 in initial state', () => {
      render(<SamGovOpportunitySearchPage orgId="test-org-id" />);

      const minDaysInput = screen.getByTestId('min-days-input');
      expect(minDaysInput).toHaveValue(null); // Empty when 0
    });

    it('includes minDaysUntilDue in active filter count when set', () => {
      render(<SamGovOpportunitySearchPage orgId="test-org-id" />);

      // Initially 0 active filters (since minDaysUntilDue is 0 and NAICS is default)
      expect(screen.getByTestId('active-filter-count')).toHaveTextContent('0');

      // Set minDaysUntilDue
      const minDaysInput = screen.getByTestId('min-days-input');
      fireEvent.change(minDaysInput, { target: { value: '7' } });

      // Should now show 1 active filter
      expect(screen.getByTestId('active-filter-count')).toHaveTextContent('1');
    });

    it('filters opportunities based on minDaysUntilDue', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 14); // 14 days from now

      const pastDueDate = new Date();
      pastDueDate.setDate(pastDueDate.getDate() + 3); // 3 days from now

      const mockData = {
        opportunities: [
          {
            noticeId: 'opp-1',
            title: 'Opportunity 1',
            responseDeadLine: futureDate.toISOString(),
          },
          {
            noticeId: 'opp-2',
            title: 'Opportunity 2',
            responseDeadLine: pastDueDate.toISOString(),
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

      // Initially shows all opportunities
      expect(screen.getByTestId('opportunity-count')).toHaveTextContent('2');

      // Set minDaysUntilDue to 7 days
      const minDaysInput = screen.getByTestId('min-days-input');
      fireEvent.change(minDaysInput, { target: { value: '7' } });

      // Should filter out the opportunity due in 3 days
      await waitFor(() => {
        expect(screen.getByTestId('opportunity-count')).toHaveTextContent('1');
      });
    });

    it('keeps opportunities without a deadline when filtering', async () => {
      const mockData = {
        opportunities: [
          {
            noticeId: 'opp-1',
            title: 'Opportunity with deadline',
            responseDeadLine: new Date().toISOString(), // Due today
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

      // Set minDaysUntilDue to 7 days
      const minDaysInput = screen.getByTestId('min-days-input');
      fireEvent.change(minDaysInput, { target: { value: '7' } });

      // Should keep the opportunity without a deadline (filter out the one due today)
      await waitFor(() => {
        expect(screen.getByTestId('opportunity-count')).toHaveTextContent('1');
      });
    });

    it('shows all opportunities when minDaysUntilDue is 0', async () => {
      const mockData = {
        opportunities: [
          { noticeId: 'opp-1', title: 'Opp 1', responseDeadLine: new Date().toISOString() },
          { noticeId: 'opp-2', title: 'Opp 2', responseDeadLine: new Date().toISOString() },
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

      // minDaysUntilDue defaults to 0, so all opportunities should be shown
      expect(screen.getByTestId('opportunity-count')).toHaveTextContent('2');
    });
  });
});
