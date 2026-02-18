import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import '@testing-library/jest-dom';

// Mock authFetcher to avoid fetch errors
jest.mock('@/lib/auth/auth-fetcher', () => ({
  authFetcher: jest.fn(() => 
    Promise.resolve({
      json: () => Promise.resolve({ hasApiKey: true })
    })
  ),
}));

// Mock env
jest.mock('@/lib/env', () => ({
  env: {
    BASE_API_URL: 'http://test-api.com',
  },
}));

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
  useSearchOpportunities: jest.fn((_orgId?: string) => ({
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

jest.mock('@/components/samgov/samgov-api-key-setup', () => ({
  SamGovApiKeySetup: () => null,
}));

jest.mock('@/components/layout/ListingPageLayout', () => ({
  ListingPageLayout: ({ children, filters }: any) => (
    <div>
      {filters}
      {children}
    </div>
  ),
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
    it('initializes rdlfrom with a default date in initial state', async () => {
      await act(async () => {
        render(<SamGovOpportunitySearchPage orgId="test-org-id" />);
      });

      await waitFor(() => {
        const rdlfromInput = screen.getByTestId('rdlfrom-input') as HTMLInputElement;
        // rdlfrom is initialized to today's date by defaultDateRange (YYYY-MM-DD format)
        expect(rdlfromInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    it('includes rdlfrom in active filter count when set', async () => {
      await act(async () => {
        render(<SamGovOpportunitySearchPage orgId="test-org-id" />);
      });

      await waitFor(() => {
        // Initially 1 active filter (rdlfrom is set by default)
        expect(screen.getByTestId('active-filter-count')).toHaveTextContent('1');
      });
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

      await act(async () => {
        render(<SamGovOpportunitySearchPage orgId="test-org-id" />);
      });

      await waitFor(() => {
        // Shows all opportunities returned from API (filtering is server-side)
        expect(screen.getByTestId('opportunity-count')).toHaveTextContent('2');
      });
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

      await act(async () => {
        render(<SamGovOpportunitySearchPage orgId="test-org-id" />);
      });

      await waitFor(() => {
        // Shows all opportunities from API response
        expect(screen.getByTestId('opportunity-count')).toHaveTextContent('2');
      });
    });

    it('updates rdlfrom when changed', async () => {
      await act(async () => {
        render(<SamGovOpportunitySearchPage orgId="test-org-id" />);
      });

      await waitFor(() => {
        expect(screen.getByTestId('rdlfrom-input')).toBeInTheDocument();
      });

      const rdlfromInput = screen.getByTestId('rdlfrom-input');
      
      await act(async () => {
        fireEvent.change(rdlfromInput, { target: { value: '2025-03-01' } });
      });

      expect(rdlfromInput).toHaveValue('2025-03-01');
    });
  });
});