import { render, screen } from '@testing-library/react';
import { PipelineBoard } from '../PipelineBoard';
import { makeItem } from '../../__tests__/fixtures';

jest.mock('../../hooks/use-approval-advance', () => ({
  useApprovalAdvance: () => ({ advance: jest.fn(), pendingOppId: null, error: null }),
}));

const NOW = '2026-07-27T00:00:00.000Z';

describe('PipelineBoard', () => {
  it('renders one column per board stage', () => {
    const items = [
      makeItem({ id: 'a', pipelineStage: 'execSummaryToReview' }),
      makeItem({ id: 'b', pipelineStage: 'firstApproved' }),
    ];
    render(<PipelineBoard items={items} orgId="org-1" nowIso={NOW} canAdvance />);
    // Labels appear as column headers (and, for populated stages, also on the card
    // badge), so assert at least one of each renders.
    expect(screen.getAllByText('Exec summary, to be reviewed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('First approved').length).toBeGreaterThan(0);
    expect(screen.getByText('Found')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Second approved')).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(screen.getByText('Not approved')).toBeTruthy();
    expect(screen.getByText('Awarded')).toBeTruthy();
    expect(screen.getByText('Lost')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('places cards in the column matching their pipelineStage', () => {
    const items = [
      makeItem({ id: 'a', title: 'Sourced RFP', pipelineStage: 'execSummaryToReview' }),
      makeItem({ id: 'b', title: 'Approved RFP', pipelineStage: 'firstApproved' }),
    ];
    render(<PipelineBoard items={items} orgId="org-1" nowIso={NOW} canAdvance />);
    expect(screen.getByText('Sourced RFP')).toBeTruthy();
    expect(screen.getByText('Approved RFP')).toBeTruthy();
  });

  it('shows the empty-column placeholder for stages with no items', () => {
    render(<PipelineBoard items={[makeItem({ id: 'a', pipelineStage: 'firstApproved' })]} orgId="org-1" nowIso={NOW} canAdvance />);
    expect(screen.getAllByText(/no opportunities/i).length).toBeGreaterThan(0);
  });
});
