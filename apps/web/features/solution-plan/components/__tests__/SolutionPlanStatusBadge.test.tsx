import { render, screen } from '@testing-library/react';
import { SolutionPlanBidDecisionBadge, SolutionPlanStatusBadge } from '../SolutionPlanStatusBadge';

describe('SolutionPlanStatusBadge', () => {
  it.each([
    ['GRILLING', 'Interview in Progress'],
    ['GENERATING_SOT', 'Generating Plan'],
    ['READY', 'Ready'],
    ['FAILED', 'Failed'],
  ] as const)('shows the human label for %s', (status, label) => {
    render(<SolutionPlanStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('shows the in-progress indicator only for running statuses', () => {
    const { container: running } = render(<SolutionPlanStatusBadge status="GRILLING" />);
    expect(running.querySelector('.animate-spin')).not.toBeNull();

    const { container: ready } = render(<SolutionPlanStatusBadge status="READY" />);
    expect(ready.querySelector('.animate-spin')).toBeNull();
  });
});

describe('SolutionPlanBidDecisionBadge', () => {
  it('renders a destructive No-Bid badge for a NO_BID decision', () => {
    render(<SolutionPlanBidDecisionBadge bidDecision="NO_BID" />);
    expect(screen.getByText('No-Bid')).toBeTruthy();
    expect(screen.getByTestId('solution-plan-no-bid-badge')).toBeTruthy();
  });

  it('renders nothing for a BID decision', () => {
    const { container } = render(<SolutionPlanBidDecisionBadge bidDecision="BID" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for legacy plans without a decision', () => {
    const { container } = render(<SolutionPlanBidDecisionBadge />);
    expect(container.firstChild).toBeNull();
  });
});
