import { render, screen } from '@testing-library/react';
import { FOIAStatusBadge } from '../FOIAStatusBadge';

describe('FOIAStatusBadge', () => {
  it('renders DRAFT status', () => {
    render(<FOIAStatusBadge status="DRAFT" />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders READY_TO_SUBMIT status', () => {
    render(<FOIAStatusBadge status="READY_TO_SUBMIT" />);
    expect(screen.getByText('Ready to Submit')).toBeInTheDocument();
  });

  it('renders SUBMITTED status', () => {
    render(<FOIAStatusBadge status="SUBMITTED" />);
    expect(screen.getByText('Submitted')).toBeInTheDocument();
  });

  it('renders ACKNOWLEDGED status', () => {
    render(<FOIAStatusBadge status="ACKNOWLEDGED" />);
    expect(screen.getByText('Acknowledged')).toBeInTheDocument();
  });

  it('renders IN_PROCESSING status', () => {
    render(<FOIAStatusBadge status="IN_PROCESSING" />);
    expect(screen.getByText('In Processing')).toBeInTheDocument();
  });

  it('renders RESPONSE_RECEIVED status', () => {
    render(<FOIAStatusBadge status="RESPONSE_RECEIVED" />);
    expect(screen.getByText('Response Received')).toBeInTheDocument();
  });

  it('renders APPEAL_FILED status', () => {
    render(<FOIAStatusBadge status="APPEAL_FILED" />);
    expect(screen.getByText('Appeal Filed')).toBeInTheDocument();
  });

  it('renders CLOSED status', () => {
    render(<FOIAStatusBadge status="CLOSED" />);
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <FOIAStatusBadge status="SUBMITTED" className="custom-class" />
    );
    const badge = container.querySelector('[data-slot="badge"]') || container.firstElementChild;
    expect(badge).toHaveClass('custom-class');
  });
});
