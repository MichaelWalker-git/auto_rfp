import { render, screen } from '@testing-library/react';
import { NeedsAttentionPanel } from '../NeedsAttentionPanel';
import { makeItem, transition } from '../../__tests__/fixtures';

describe('NeedsAttentionPanel', () => {
  it('shows the healthy empty state when there are no flags', () => {
    const healthy = makeItem({
      status: 'PURSUING',
      responseDeadlineIso: '2026-08-01T00:00:00.000Z',
      statusHistory: [transition('PURSUING', '2026-07-01T00:00:00.000Z', 'QUALIFYING')],
    });
    render(<NeedsAttentionPanel items={[healthy]} orgId="org-1" />);
    expect(screen.getByText(/nothing needs attention/i)).toBeTruthy();
  });

  it('groups flags under their category header with a count', () => {
    const missingOwner = makeItem({
      id: 'a',
      title: 'No Owner RFP',
      status: 'PURSUING',
      assigneeId: undefined,
      responseDeadlineIso: '2026-08-01T00:00:00.000Z',
    });
    render(<NeedsAttentionPanel items={[missingOwner]} orgId="org-1" />);
    // "no owner assigned" appears in both the category header and the message.
    expect(screen.getAllByText(/no owner assigned/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/is active but has no owner/i)).toBeTruthy();
  });

  it('links a flagged item with a sourceUrl to its Linear issue in a new tab', () => {
    const item = makeItem({
      id: 'opp-5',
      oppId: 'opp-5',
      projectId: 'proj-2',
      status: 'PURSUING',
      responseDeadlineIso: undefined,
      sourceUrl: 'https://linear.app/acme/issue/GOV-5',
    });
    render(<NeedsAttentionPanel items={[item]} orgId="org-9" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://linear.app/acme/issue/GOV-5');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders a flagged item without a sourceUrl as non-clickable text', () => {
    const item = makeItem({
      id: 'opp-6',
      oppId: 'opp-6',
      projectId: 'proj-2',
      status: 'PURSUING',
      responseDeadlineIso: undefined,
      sourceUrl: undefined,
    });
    render(<NeedsAttentionPanel items={[item]} orgId="org-9" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/is active but has no response deadline/i)).toBeTruthy();
  });

  it('renders multiple flag categories at once', () => {
    const items = [
      makeItem({ id: 'a', status: 'PURSUING', assigneeId: undefined, responseDeadlineIso: '2026-08-01T00:00:00.000Z' }),
      makeItem({ id: 'b', approvalStatus: 'SUBMITTED', approvalHistory: [] }),
    ];
    render(<NeedsAttentionPanel items={items} orgId="org-1" />);
    expect(screen.getAllByText(/no owner assigned/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/submitted without final approval/i).length).toBeGreaterThanOrEqual(1);
  });
});
