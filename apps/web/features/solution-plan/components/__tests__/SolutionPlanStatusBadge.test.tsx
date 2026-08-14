import { render, screen } from '@testing-library/react';
import { SolutionPlanStatusBadge } from '../SolutionPlanStatusBadge';

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
