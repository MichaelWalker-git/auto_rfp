import { render, screen } from '@testing-library/react';
import { PipelineCardDetail } from '../PipelineCardDetail';
import { makeItem, transition, approvalTransition } from '../../__tests__/fixtures';

const noop = () => {};

describe('PipelineCardDetail', () => {
  it('renders the title and solicitation number in the header', () => {
    const item = makeItem({ title: 'Cloud RFP', solicitationNumber: 'SOL-123' });
    render(<PipelineCardDetail item={item} orgId="org-1" open onOpenChange={noop} />);
    expect(screen.getByText('Cloud RFP')).toBeTruthy();
    expect(screen.getByText('SOL-123')).toBeTruthy();
  });

  it('renders merged timeline entries (status + approval), most recent first', () => {
    const item = makeItem({
      statusHistory: [transition('SUBMITTED', '2026-07-20T00:00:00.000Z', 'PURSUING')],
      approvalHistory: [approvalTransition('PRE_SUB_APPROVAL', '2026-07-10T00:00:00.000Z', 'I_APPROVED', 'STAGE')],
    });
    render(<PipelineCardDetail item={item} orgId="org-1" open onOpenChange={noop} />);

    expect(screen.getByText('Status: Pursuing → Submitted')).toBeTruthy();
    expect(screen.getByText('Approval: I Approved → Pre Sub Approval')).toBeTruthy();

    const labels = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '');
    expect(labels[0]).toContain('Status: Pursuing → Submitted');
    expect(labels[1]).toContain('Approval: I Approved → Pre Sub Approval');
  });

  it('shows an empty state when there is no history', () => {
    const item = makeItem({ statusHistory: [], approvalHistory: [] });
    render(<PipelineCardDetail item={item} orgId="org-1" open onOpenChange={noop} />);
    expect(screen.getByText('No recorded transitions yet.')).toBeTruthy();
  });

  it('renders the Linear link when sourceUrl is present', () => {
    const item = makeItem({ sourceUrl: 'https://linear.app/team/issue/HOR-42' });
    render(<PipelineCardDetail item={item} orgId="org-1" open onOpenChange={noop} />);
    const link = screen.getByRole('link', { name: /open in linear/i });
    expect(link.getAttribute('href')).toBe('https://linear.app/team/issue/HOR-42');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('does not render the Linear link when sourceUrl is absent', () => {
    const item = makeItem({ sourceUrl: null });
    render(<PipelineCardDetail item={item} orgId="org-1" open onOpenChange={noop} />);
    expect(screen.queryByRole('link', { name: /open in linear/i })).toBeNull();
  });

  it('renders the full-opportunity link when projectId + oppId are present', () => {
    const item = makeItem({ id: 'opp-9', oppId: 'opp-9', projectId: 'proj-7' });
    render(<PipelineCardDetail item={item} orgId="org-3" open onOpenChange={noop} />);
    const link = screen.getByRole('link', { name: /view full opportunity/i });
    expect(link.getAttribute('href')).toBe('/organizations/org-3/projects/proj-7/opportunities/opp-9');
  });

  it('omits the full-opportunity link when projectId is missing', () => {
    const item = makeItem({ projectId: undefined, sourceUrl: null });
    render(<PipelineCardDetail item={item} orgId="org-1" open onOpenChange={noop} />);
    expect(screen.queryByRole('link', { name: /view full opportunity/i })).toBeNull();
    expect(screen.getByText('No external links available.')).toBeTruthy();
  });
});
