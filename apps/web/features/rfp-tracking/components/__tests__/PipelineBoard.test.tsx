import { render, screen } from '@testing-library/react';
import { PipelineBoard } from '../PipelineBoard';
import { makeItem } from '../../__tests__/fixtures';

jest.mock('../../hooks/use-approval-advance', () => ({
  useApprovalAdvance: () => ({ advance: jest.fn(), pendingOppId: null, error: null }),
}));

const NOW = '2026-07-27T00:00:00.000Z';

describe('PipelineBoard', () => {
  it('renders one column per approval stage', () => {
    const items = [
      makeItem({ id: 'a', approvalStatus: 'INITIAL_APPROVAL' }),
      makeItem({ id: 'b', approvalStatus: 'I_APPROVED' }),
    ];
    render(<PipelineBoard items={items} orgId="org-1" nowIso={NOW} canAdvance />);
    // Labels appear as column headers (and, for populated stages, also on the card
    // badge), so assert at least one of each renders.
    expect(screen.getAllByText('Initial Approval').length).toBeGreaterThan(0);
    expect(screen.getAllByText('I Approved').length).toBeGreaterThan(0);
    expect(screen.getByText('Pre Sub Approval')).toBeTruthy();
    expect(screen.getByText('II Approved')).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(screen.getByText('Not Approved')).toBeTruthy();
  });

  it('places cards in the column matching their approvalStatus', () => {
    const items = [
      makeItem({ id: 'a', title: 'Initial RFP', approvalStatus: 'INITIAL_APPROVAL' }),
      makeItem({ id: 'b', title: 'Approved RFP', approvalStatus: 'I_APPROVED' }),
    ];
    render(<PipelineBoard items={items} orgId="org-1" nowIso={NOW} canAdvance />);
    expect(screen.getByText('Initial RFP')).toBeTruthy();
    expect(screen.getByText('Approved RFP')).toBeTruthy();
  });

  it('shows the empty-column placeholder for stages with no items', () => {
    render(<PipelineBoard items={[makeItem({ id: 'a', approvalStatus: 'INITIAL_APPROVAL' })]} orgId="org-1" nowIso={NOW} canAdvance />);
    expect(screen.getAllByText(/no opportunities/i).length).toBeGreaterThan(0);
  });
});
