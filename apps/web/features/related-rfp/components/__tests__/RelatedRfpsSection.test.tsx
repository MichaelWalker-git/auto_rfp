import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RelatedRfpsSection } from '../RelatedRfpsSection';
import type { RelatedRfpListItem } from '@auto-rfp/core';

jest.mock('next/link', () => ({
  __esModule: true,
  default: React.forwardRef<HTMLAnchorElement, { href: string; children: React.ReactNode }>(
    ({ href, children, ...rest }, ref) => (
      <a href={href} ref={ref} {...rest}>
        {children}
      </a>
    ),
  ),
}));

const mockUseRelatedRfps = jest.fn();
jest.mock('../../hooks/useRelatedRfps', () => ({
  useRelatedRfps: (...args: unknown[]) => mockUseRelatedRfps(...args),
}));

const mockAddRelated = jest.fn();
const mockRemoveRelated = jest.fn();
const mockRefreshRelated = jest.fn();
jest.mock('../../hooks/useRelatedRfpMutations', () => ({
  useRelatedRfpMutations: () => ({
    addRelated: mockAddRelated,
    removeRelated: mockRemoveRelated,
    refreshRelated: mockRefreshRelated,
  }),
}));

// Keep the dialog inert; its own behavior is covered elsewhere.
jest.mock('../AddRelatedRfpDialog', () => ({
  AddRelatedRfpDialog: () => <div data-testid="add-dialog" />,
}));

let mockCanRemoveAuto = false;
jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  usePermission: () => mockCanRemoveAuto,
}));

const scope = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

const item = (over: Partial<RelatedRfpListItem> = {}): RelatedRfpListItem => ({
  id: 'rel-1',
  relatedOppKey: 'HG-1',
  title: 'Past RFP',
  organizationName: 'NASA',
  postedDateIso: null,
  dueDateIso: null,
  sourceUrl: 'https://highergov.com/opp/HG-1',
  matchScore: 0.5,
  origin: 'AUTO',
  linkedOpportunityId: null,
  ...over,
});

const defaultHook = {
  items: [] as RelatedRfpListItem[],
  isLoading: false,
  isError: false,
  error: null,
  mutate: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCanRemoveAuto = false;
  mockUseRelatedRfps.mockReturnValue(defaultHook);
});

describe('RelatedRfpsSection', () => {
  it('shows skeletons while loading', () => {
    mockUseRelatedRfps.mockReturnValue({ ...defaultHook, isLoading: true });
    const { container } = render(<RelatedRfpsSection {...scope} />);
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows an empty state when there are no related RFPs', () => {
    render(<RelatedRfpsSection {...scope} />);
    expect(screen.getByText(/No related RFPs yet/i)).toBeInTheDocument();
  });

  it('renders rows for each related RFP', () => {
    mockUseRelatedRfps.mockReturnValue({
      ...defaultHook,
      items: [item(), item({ id: 'rel-2', relatedOppKey: 'HG-2', title: 'Another RFP' })],
    });
    render(<RelatedRfpsSection {...scope} />);
    expect(screen.getByText('Past RFP')).toBeInTheDocument();
    expect(screen.getByText('Another RFP')).toBeInTheDocument();
  });

  it('hides the remove button for AUTO links without the admin permission', () => {
    mockUseRelatedRfps.mockReturnValue({ ...defaultHook, items: [item()] });
    render(<RelatedRfpsSection {...scope} />);
    expect(screen.queryByLabelText('Remove related RFP')).not.toBeInTheDocument();
  });

  it('shows the remove button for AUTO links when the user has related_rfp:remove_auto', () => {
    mockCanRemoveAuto = true;
    mockUseRelatedRfps.mockReturnValue({ ...defaultHook, items: [item()] });
    render(<RelatedRfpsSection {...scope} />);
    expect(screen.getByLabelText('Remove related RFP')).toBeInTheDocument();
  });

  it('always allows removing MANUAL links', () => {
    mockUseRelatedRfps.mockReturnValue({ ...defaultHook, items: [item({ origin: 'MANUAL', matchScore: null })] });
    render(<RelatedRfpsSection {...scope} />);
    expect(screen.getByLabelText('Remove related RFP')).toBeInTheDocument();
  });

  it('triggers refresh discovery when Refresh is clicked', async () => {
    mockRefreshRelated.mockResolvedValue(undefined);
    render(<RelatedRfpsSection {...scope} />);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(mockRefreshRelated).toHaveBeenCalled());
  });
});
