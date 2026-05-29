import { render, screen } from '@testing-library/react';
import { DebriefingStatusBadge } from '../DebriefingStatusBadge';

describe('DebriefingStatusBadge', () => {
  it('renders NOT_REQUESTED status', () => {
    render(<DebriefingStatusBadge status="NOT_REQUESTED" />);
    expect(screen.getByText('Not Requested')).toBeInTheDocument();
  });

  it('renders REQUESTED status', () => {
    render(<DebriefingStatusBadge status="REQUESTED" />);
    expect(screen.getByText('Requested')).toBeInTheDocument();
  });

  it('renders SCHEDULED status', () => {
    render(<DebriefingStatusBadge status="SCHEDULED" />);
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('renders COMPLETED status', () => {
    render(<DebriefingStatusBadge status="COMPLETED" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders DECLINED status', () => {
    render(<DebriefingStatusBadge status="DECLINED" />);
    expect(screen.getByText('Declined')).toBeInTheDocument();
  });

  it('displays icon for each status', () => {
    const { container } = render(<DebriefingStatusBadge status="REQUESTED" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <DebriefingStatusBadge status="COMPLETED" className="custom-class" />
    );
    const badge = container.querySelector('[data-slot="badge"]') || container.firstElementChild;
    expect(badge).toHaveClass('custom-class');
  });

  it('applies green background for COMPLETED status', () => {
    const { container } = render(<DebriefingStatusBadge status="COMPLETED" />);
    const badge = container.querySelector('[data-slot="badge"]') || container.firstElementChild;
    expect(badge).toHaveClass('bg-green-600');
  });
});
