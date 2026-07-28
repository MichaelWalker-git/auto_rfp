import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineCard } from '../PipelineCard';
import { toBoardCard } from '../../lib/derive-board';
import { makeItem, approvalTransition } from '../../__tests__/fixtures';

const mockAdvance = jest.fn();
jest.mock('../../hooks/use-approval-advance', () => ({
  useApprovalAdvance: () => ({ advance: mockAdvance, pendingOppId: null, error: null }),
}));

const NOW = '2026-07-27T00:00:00.000Z';

beforeEach(() => jest.clearAllMocks());

describe('PipelineCard', () => {
  it('renders title, owner, value, approval badge, and days-in-stage', () => {
    const item = makeItem({
      title: 'Cloud RFP',
      assigneeName: 'Jane Doe',
      baseAndAllOptionsValue: 250_000,
      approvalStatus: 'PRE_SUB_APPROVAL',
      approvalHistory: [approvalTransition('PRE_SUB_APPROVAL', '2026-07-17T00:00:00.000Z', 'I_APPROVED', 'STAGE')],
    });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);

    expect(screen.getByText('Cloud RFP')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('$250,000')).toBeTruthy();
    expect(screen.getByText('Pre Sub Approval')).toBeTruthy();
    expect(screen.getByText(/10d in stage/)).toBeTruthy();
  });

  it('links to the opportunity detail route when projectId + oppId are present', () => {
    const item = makeItem({ id: 'opp-9', oppId: 'opp-9', projectId: 'proj-7' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-3" canAdvance={false} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/organizations/org-3/projects/proj-7/opportunities/opp-9');
  });

  it('renders as a static card (no link) when projectId is missing', () => {
    const item = makeItem({ projectId: undefined });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows "Unassigned" when there is no owner', () => {
    const item = makeItem({ assigneeName: undefined });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('offers "Send for Pre-Sub Review" on I_APPROVED and advances to PRE_SUB_APPROVAL', () => {
    const item = makeItem({ id: 'opp-1', oppId: 'opp-1', projectId: 'proj-1', approvalStatus: 'I_APPROVED' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance />);
    fireEvent.click(screen.getByRole('button', { name: /send for pre-sub review/i }));
    expect(mockAdvance).toHaveBeenCalledWith({ projectId: 'proj-1', oppId: 'opp-1', to: 'PRE_SUB_APPROVAL' });
  });

  it('offers "Mark Submitted" on II_APPROVED and advances to SUBMITTED', () => {
    const item = makeItem({ id: 'opp-2', oppId: 'opp-2', projectId: 'proj-1', approvalStatus: 'II_APPROVED' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance />);
    fireEvent.click(screen.getByRole('button', { name: /mark submitted/i }));
    expect(mockAdvance).toHaveBeenCalledWith({ projectId: 'proj-1', oppId: 'opp-2', to: 'SUBMITTED' });
  });

  it('hides stage-advance actions when canAdvance is false', () => {
    const item = makeItem({ approvalStatus: 'I_APPROVED', projectId: 'proj-1' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance={false} />);
    expect(screen.queryByRole('button', { name: /send for pre-sub review/i })).toBeNull();
  });

  it('shows no advance action on a non-advanceable stage', () => {
    const item = makeItem({ approvalStatus: 'INITIAL_APPROVAL', projectId: 'proj-1' });
    render(<PipelineCard card={toBoardCard(item, NOW)} orgId="org-1" canAdvance />);
    expect(screen.queryByRole('button', { name: /send for pre-sub review|mark submitted/i })).toBeNull();
  });
});
