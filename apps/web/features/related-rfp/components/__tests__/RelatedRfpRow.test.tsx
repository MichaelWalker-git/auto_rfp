import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { RelatedRfpRow } from '../RelatedRfpRow';
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

const baseItem = (over: Partial<RelatedRfpListItem> = {}): RelatedRfpListItem => ({
  id: 'rel-1',
  relatedOppKey: 'HG-KEY-1',
  title: 'Base Operations Support Services',
  organizationName: 'Dept. of Energy',
  postedDateIso: '2025-06-01T00:00:00.000Z',
  dueDateIso: '2025-07-15T00:00:00.000Z',
  sourceUrl: 'https://highergov.com/opp/HG-KEY-1',
  matchScore: 0.82,
  origin: 'AUTO',
  linkedOpportunityId: null,
  ...over,
});

describe('RelatedRfpRow', () => {
  it('renders title, agency, and Auto badge with match score for AUTO links', () => {
    render(<RelatedRfpRow item={baseItem()} canRemove={false} onRemove={jest.fn()} />);
    expect(screen.getByText('Base Operations Support Services')).toBeInTheDocument();
    expect(screen.getByText('Dept. of Energy')).toBeInTheDocument();
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.getByText('82% match')).toBeInTheDocument();
  });

  it('renders "Added" badge and no score for MANUAL links', () => {
    render(
      <RelatedRfpRow
        item={baseItem({ origin: 'MANUAL', matchScore: null })}
        canRemove={false}
        onRemove={jest.fn()}
      />,
    );
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.queryByText(/% match/)).not.toBeInTheDocument();
  });

  it('links out to HigherGov when not imported in-app', () => {
    render(<RelatedRfpRow item={baseItem()} canRemove={false} onRemove={jest.fn()} />);
    const link = screen.getByRole('link', { name: /HigherGov/i });
    expect(link).toHaveAttribute('href', 'https://highergov.com/opp/HG-KEY-1');
  });

  it('deep-links in-app when a linkedHref is provided', () => {
    render(
      <RelatedRfpRow
        item={baseItem({ linkedOpportunityId: 'opp-99' })}
        linkedHref="/organizations/o/projects/p/opportunities/opp-99"
        canRemove={false}
        onRemove={jest.fn()}
      />,
    );
    const link = screen.getByRole('link', { name: /View/i });
    expect(link).toHaveAttribute('href', '/organizations/o/projects/p/opportunities/opp-99');
    expect(screen.queryByRole('link', { name: /HigherGov/i })).not.toBeInTheDocument();
  });

  it('shows a remove button only when canRemove and fires onRemove with the opp key', () => {
    const onRemove = jest.fn();
    const { rerender } = render(
      <RelatedRfpRow item={baseItem()} canRemove={false} onRemove={onRemove} />,
    );
    expect(screen.queryByLabelText('Remove related RFP')).not.toBeInTheDocument();

    rerender(<RelatedRfpRow item={baseItem()} canRemove onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Remove related RFP'));
    expect(onRemove).toHaveBeenCalledWith('HG-KEY-1');
  });
});
