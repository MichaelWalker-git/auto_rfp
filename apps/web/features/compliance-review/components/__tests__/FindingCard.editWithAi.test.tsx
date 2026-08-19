import { render, screen, fireEvent } from '@testing-library/react';

// Mock the cross-feature seam so we don't pull SWR/network into this UI test.
jest.mock('@/features/package-edit', () => ({
  InlineFindingEditor: () => <div data-testid="inline-finding-editor" />,
}));

// buildFindingHref is pure but touches routing constants — keep it simple.
jest.mock('../../lib/navigateToFinding', () => ({
  buildFindingHref: () => '/go',
}));

import { FindingCard } from '../FindingCard';
import type { DecoratedFinding } from '../../hooks/useFindingDecisions';

const finding = (over: Partial<DecoratedFinding> = {}): DecoratedFinding => ({
  findingId: 'f1',
  fingerprint: 'fp1',
  targetKind: 'RFP_DOCUMENT',
  issueType: 'INCONSISTENCY',
  severity: 'major',
  title: 'Cost differs across documents',
  description: 'The total disagrees.',
  anchorValid: true,
  ...over,
});

const baseProps = { orgId: 'o', projectId: 'p', oppId: 'opp' };

describe('FindingCard — Edit with AI', () => {
  it('shows the "Edit with AI" button on a full-review finding', () => {
    render(<FindingCard finding={finding()} {...baseProps} />);
    expect(screen.getByRole('button', { name: /edit with ai/i })).toBeTruthy();
  });

  it('opens the inline editor when clicked', () => {
    render(<FindingCard finding={finding()} {...baseProps} />);
    expect(screen.queryByTestId('inline-finding-editor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }));
    expect(screen.getByTestId('inline-finding-editor')).toBeTruthy();
  });

  it('keeps the editor MOUNTED across toggles (only hides it) so proposals are not discarded', () => {
    const { container } = render(<FindingCard finding={finding()} {...baseProps} />);
    const btn = () => screen.getByRole('button', { name: /edit with ai|hide ai editor/i });

    // Open → editor mounted and visible.
    fireEvent.click(btn());
    const editor = screen.getByTestId('inline-finding-editor');
    expect(editor).toBeTruthy();

    // Toggle closed → SAME node stays in the DOM (not unmounted), just hidden.
    fireEvent.click(btn());
    expect(screen.getByTestId('inline-finding-editor')).toBe(editor); // identity preserved
    expect(container.querySelector('.hidden')?.contains(editor)).toBe(true);

    // Toggle open again → still the same node (state intact).
    fireEvent.click(btn());
    expect(screen.getByTestId('inline-finding-editor')).toBe(editor);
  });

  it('toggles the button label between "Edit with AI" and "Hide AI editor"', () => {
    render(<FindingCard finding={finding()} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }));
    expect(screen.getByRole('button', { name: /hide ai editor/i })).toBeTruthy();
  });

  it('hides "Edit with AI" for read-only (chat) findings', () => {
    render(<FindingCard finding={finding()} {...baseProps} readOnly />);
    expect(screen.queryByRole('button', { name: /edit with ai/i })).toBeNull();
  });
});
