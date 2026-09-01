import { render, screen } from '@testing-library/react';
import type { OpportunityListItem } from '@auto-rfp/core';
import { OpportunityItemCard } from '../opportunity-item-card';

jest.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'proj-1' }),
}));

jest.mock('@/lib/hooks/use-opportunities', () => ({
  useDeleteOpportunity: () => ({ trigger: jest.fn(), isMutating: false }),
}));

jest.mock('@/lib/hooks/use-opportunity-assignment', () => ({
  useAssignOpportunity: () => ({ assign: jest.fn(), isAssigning: false }),
}));

jest.mock('@/lib/hooks/use-project-access', () => ({
  useProjectAccessUsers: () => ({ users: [] }),
}));

jest.mock('@/lib/hooks/use-user', () => ({
  useUsersList: () => ({ data: { items: [] } }),
}));

jest.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ userSub: 'user-1' }),
}));

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({ currentOrganization: { id: 'org-1' } }),
}));

const baseItem: OpportunityListItem = {
  id: 'opp-1',
  oppId: 'opp-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  source: 'SAM_GOV',
  title: 'Widget procurement',
  status: 'IDENTIFIED',
  notarySummary: null,
};

describe('OpportunityItemCard — physical submission chip', () => {
  it('renders the physical submission chip when submissionMethod is PHYSICAL', () => {
    render(<OpportunityItemCard item={{ ...baseItem, submissionMethod: 'PHYSICAL' }} />);
    expect(screen.getByTestId('physical-submission-chip')).toBeInTheDocument();
  });

  it('does not render the chip when submissionMethod is ELECTRONIC', () => {
    render(<OpportunityItemCard item={{ ...baseItem, submissionMethod: 'ELECTRONIC' }} />);
    expect(screen.queryByTestId('physical-submission-chip')).not.toBeInTheDocument();
  });

  it('does not render the chip when submissionMethod is absent', () => {
    render(<OpportunityItemCard item={baseItem} />);
    expect(screen.queryByTestId('physical-submission-chip')).not.toBeInTheDocument();
  });
});
