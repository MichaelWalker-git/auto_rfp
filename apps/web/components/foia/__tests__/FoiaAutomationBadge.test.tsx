import React from 'react';
import { render, screen } from '@testing-library/react';
import { FoiaAutomationBadge } from '../FoiaAutomationBadge';
import type { FoiaAutomationState } from '@auto-rfp/core';

describe('FoiaAutomationBadge', () => {
  it('renders nothing for null state', () => {
    const { container } = render(<FoiaAutomationBadge state={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for undefined state', () => {
    const { container } = render(<FoiaAutomationBadge state={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for NOT_APPLICABLE state', () => {
    const { container } = render(<FoiaAutomationBadge state="NOT_APPLICABLE" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders SCHEDULED state with correct label', () => {
    render(<FoiaAutomationBadge state="SCHEDULED" />);
    expect(screen.getByText('FOIA scheduled')).toBeInTheDocument();
  });

  it('renders BLOCKED state with correct label', () => {
    render(<FoiaAutomationBadge state="BLOCKED" />);
    expect(screen.getByText('FOIA needs input')).toBeInTheDocument();
  });

  it('renders AWAITING_APPROVAL state with correct label', () => {
    render(<FoiaAutomationBadge state="AWAITING_APPROVAL" />);
    expect(screen.getByText('FOIA awaiting approval')).toBeInTheDocument();
  });

  it('renders STALLED state with correct label', () => {
    render(<FoiaAutomationBadge state="STALLED" />);
    expect(screen.getByText('FOIA approval overdue')).toBeInTheDocument();
  });

  it('renders SENDING state with correct label', () => {
    render(<FoiaAutomationBadge state="SENDING" />);
    expect(screen.getByText('FOIA sending')).toBeInTheDocument();
  });

  it('renders SENT state with correct label', () => {
    render(<FoiaAutomationBadge state="SENT" />);
    expect(screen.getByText('FOIA sent')).toBeInTheDocument();
  });

  it('renders BOUNCED state with correct label', () => {
    render(<FoiaAutomationBadge state="BOUNCED" />);
    expect(screen.getByText('FOIA bounced')).toBeInTheDocument();
  });

  it('renders FAILED state with correct label', () => {
    render(<FoiaAutomationBadge state="FAILED" />);
    expect(screen.getByText('FOIA send failed')).toBeInTheDocument();
  });

  it('renders SUPPRESSED state with correct label', () => {
    render(<FoiaAutomationBadge state="SUPPRESSED" />);
    expect(screen.getByText('FOIA not needed')).toBeInTheDocument();
  });

  it('renders MANUAL_COMPLETED state with correct label', () => {
    render(<FoiaAutomationBadge state="MANUAL_COMPLETED" />);
    expect(screen.getByText('FOIA filed manually')).toBeInTheDocument();
  });

  it('applies custom className when provided', () => {
    const { container } = render(<FoiaAutomationBadge state="SCHEDULED" className="custom-class" />);
    const badge = container.querySelector('.custom-class');
    expect(badge).toBeInTheDocument();
  });

  it('renders with correct icon for failure states', () => {
    const { container } = render(<FoiaAutomationBadge state="BLOCKED" />);
    // Check that an icon (svg) is rendered
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('renders with correct icon for pending states', () => {
    const { container } = render(<FoiaAutomationBadge state="SCHEDULED" />);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('renders with correct icon for completed states', () => {
    const { container } = render(<FoiaAutomationBadge state="SENT" />);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });
});
