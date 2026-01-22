import { render, screen } from '@testing-library/react';
import { SamGovOpportunityList } from '../samgov-opportunity-list';
import type { SamOpportunitySlim } from '@auto-rfp/shared';

describe('SamGovOpportunityList', () => {
  const mockOnPage = jest.fn();
  const mockOnImport = jest.fn();

  const baseOpportunity: SamOpportunitySlim = {
    noticeId: 'notice-123',
    title: 'Test Opportunity',
    solicitationNumber: 'SOL-123',
    active: 'Yes',
    postedDate: '2025-01-15',
    responseDeadLine: '2025-02-15',
    naicsCode: '541512',
    classificationCode: 'D301',
    attachmentsCount: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows "No files" badge when attachmentsCount is 0', () => {
    const data = {
      opportunities: [{ ...baseOpportunity, attachmentsCount: 0 }],
      totalRecords: 1,
      limit: 25,
      offset: 0,
    };

    render(
      <SamGovOpportunityList
        data={data}
        isLoading={false}
        onPage={mockOnPage}
        onImportSolicitation={mockOnImport}
      />
    );

    expect(screen.getByText('No files')).toBeInTheDocument();
  });

  it('shows attachment count when attachments are available', () => {
    const data = {
      opportunities: [{ ...baseOpportunity, attachmentsCount: 5 }],
      totalRecords: 1,
      limit: 25,
      offset: 0,
    };

    render(
      <SamGovOpportunityList
        data={data}
        isLoading={false}
        onPage={mockOnPage}
        onImportSolicitation={mockOnImport}
      />
    );

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('No files')).not.toBeInTheDocument();
  });

  it('renders opportunity title', () => {
    const data = {
      opportunities: [baseOpportunity],
      totalRecords: 1,
      limit: 25,
      offset: 0,
    };

    render(
      <SamGovOpportunityList
        data={data}
        isLoading={false}
        onPage={mockOnPage}
        onImportSolicitation={mockOnImport}
      />
    );

    expect(screen.getByText('Test Opportunity')).toBeInTheDocument();
  });
});
