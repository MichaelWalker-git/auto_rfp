import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotaryRequirement, NotaryStatus } from '@auto-rfp/core';
import { NotaryBadge } from '../NotaryBadge';
import { NotaryTriggerList } from '../NotaryTriggerList';

const requirements: NotaryRequirement[] = [
  {
    documentName: 'SF-1449.pdf',
    status: 'REQUIRED',
    cue: 'ACK_BLOCK',
    pageNumber: 2,
    triggeringText: 'Subscribed and sworn before me',
    rationale: 'Acknowledgment block present',
  },
];

const noop = () => undefined;

const controlledProps = { isExpanded: false, onToggleExpanded: noop, detailId: 'detail-1' };

/**
 * Mirrors the FormRow wiring: the badge is a controlled toggle and the evidence
 * panel renders as a separate block BELOW (never inline beside the form name).
 */
const RowHarness = ({ status }: { status: NotaryStatus }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div>
      <div data-testid="header-row">
        <NotaryBadge
          status={status}
          isExpanded={isExpanded}
          onToggleExpanded={() => setIsExpanded((prev) => !prev)}
          detailId="notary-detail"
        />
      </div>
      {isExpanded && (
        <div id="notary-detail" data-testid="detail-block">
          <NotaryTriggerList requirements={requirements} />
        </div>
      )}
    </div>
  );
};

describe('NotaryBadge', () => {
  it('renders an amber badge for REQUIRED with icon + accessible label', () => {
    render(<NotaryBadge status="REQUIRED" {...controlledProps} />);
    const badge = screen.getByTestId('notary-badge-REQUIRED');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-amber-100');
    expect(badge).toHaveAttribute('aria-label', 'Notary required');
    expect(screen.getByText('Notary required')).toBeInTheDocument();
  });

  it('renders a yellow badge for POSSIBLY_REQUIRED', () => {
    render(<NotaryBadge status="POSSIBLY_REQUIRED" {...controlledProps} />);
    const badge = screen.getByTestId('notary-badge-POSSIBLY_REQUIRED');
    expect(badge).toHaveClass('bg-yellow-100');
    expect(badge).toHaveAttribute('aria-label', 'Notary — review needed');
  });

  it('renders nothing for NOT_REQUIRED', () => {
    const { container } = render(<NotaryBadge status="NOT_REQUIRED" {...controlledProps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for null / undefined status', () => {
    const { container: a } = render(<NotaryBadge status={null} {...controlledProps} />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(
      <NotaryBadge status={undefined as unknown as NotaryStatus} {...controlledProps} />,
    );
    expect(b).toBeEmptyDOMElement();
  });

  it('never renders the evidence panel itself — it only reports toggle clicks (controlled)', async () => {
    const user = userEvent.setup();
    const handleToggle = jest.fn();
    render(
      <NotaryBadge
        status="REQUIRED"
        isExpanded={false}
        onToggleExpanded={handleToggle}
        detailId="detail-1"
      />,
    );

    // The panel is the PARENT's responsibility — the badge renders no trigger rows,
    // even when clicked.
    await user.click(screen.getByTestId('notary-badge-expand-toggle'));
    expect(handleToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('notary-trigger-row')).not.toBeInTheDocument();
  });

  it('reflects the controlled isExpanded state in aria-expanded and aria-controls', () => {
    const { rerender } = render(<NotaryBadge status="REQUIRED" {...controlledProps} />);
    const toggle = screen.getByTestId('notary-badge-expand-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'detail-1');

    rerender(<NotaryBadge status="REQUIRED" {...controlledProps} isExpanded={true} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('row wiring: click reveals the detail block BELOW the header row, click again hides it', async () => {
    const user = userEvent.setup();
    render(<RowHarness status="REQUIRED" />);

    const toggle = screen.getByTestId('notary-badge-expand-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('notary-trigger-row')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('notary-trigger-row')).toBeInTheDocument();
    // The panel is a sibling block below the header row — not nested inside it.
    expect(screen.getByTestId('header-row')).not.toContainElement(
      screen.getByTestId('detail-block'),
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('notary-trigger-row')).not.toBeInTheDocument();
  });

  it('row wiring: expand toggle is keyboard operable (focus + Enter, Space)', async () => {
    const user = userEvent.setup();
    render(<RowHarness status="REQUIRED" />);

    const toggle = screen.getByTestId('notary-badge-expand-toggle');
    toggle.focus();
    expect(toggle).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('notary-trigger-row')).toBeInTheDocument();

    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
