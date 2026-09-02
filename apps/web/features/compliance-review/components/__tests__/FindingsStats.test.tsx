import { render, screen, fireEvent } from '@testing-library/react';
import { FindingsStats } from '../FindingsStats';
import type { ComplianceFinding } from '@auto-rfp/core';

const f = (over: Partial<ComplianceFinding>): ComplianceFinding => ({
  findingId: Math.random().toString(),
  fingerprint: Math.random().toString(),
  targetKind: 'RFP_DOCUMENT',
  issueType: 'POOR_ANSWER',
  severity: 'minor',
  title: 't',
  description: 'd',
  anchorValid: true,
  ...over,
});

describe('FindingsStats', () => {
  it('shows an empty message when there are no findings', () => {
    render(<FindingsStats findings={[]} />);
    expect(screen.getByText(/No active findings/i)).toBeTruthy();
  });

  it('shows the hero total count and its label', () => {
    render(<FindingsStats findings={[f({}), f({}), f({})]} />);
    // 3 findings, all minor → the hero "3" and the "3 minor" badge both show "3".
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('findings')).toBeTruthy();
  });

  it('uses the singular label for one finding', () => {
    render(<FindingsStats findings={[f({})]} />);
    expect(screen.getByText('finding')).toBeTruthy();
  });

  it('breaks findings down by issue type with human labels', () => {
    const { container } = render(
      <FindingsStats
        findings={[
          f({ issueType: 'MISSING_FORM' }),
          f({ issueType: 'MISSING_FORM' }),
          f({ issueType: 'INCORRECT_ANSWER' }),
        ]}
      />,
    );
    // Sorted by count desc: 2 missing forms first, then 1 incorrect answer.
    expect(container.textContent).toContain('2 missing forms · 1 incorrect answers');
  });

  it('summarizes severities (critical first)', () => {
    render(
      <FindingsStats
        findings={[
          f({ severity: 'critical' }),
          f({ severity: 'info' }),
          f({ severity: 'critical' }),
        ]}
      />,
    );
    // Count + label share one badge text node ("2 critical", "1 info").
    expect(screen.getByText('2 critical')).toBeTruthy();
    expect(screen.getByText('1 info')).toBeTruthy();
  });

  it('renders severity badges as static (non-button) when no toggle handler is given', () => {
    render(<FindingsStats findings={[f({ severity: 'critical' })]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('calls onToggleSeverity with the clicked severity', () => {
    const onToggle = jest.fn();
    render(
      <FindingsStats
        findings={[f({ severity: 'critical' }), f({ severity: 'minor' })]}
        activeSeverity={null}
        onToggleSeverity={onToggle}
      />,
    );
    // The clickable badge is a button wrapping the "1 critical" text.
    fireEvent.click(screen.getByText('1 critical').closest('button')!);
    expect(onToggle).toHaveBeenCalledWith('critical');
  });

  it('marks the active severity pressed and offers to clear it', () => {
    const onToggle = jest.fn();
    render(
      <FindingsStats
        findings={[f({ severity: 'critical' }), f({ severity: 'minor' })]}
        activeSeverity="critical"
        onToggleSeverity={onToggle}
      />,
    );
    const active = screen.getByText('1 critical').closest('button')!;
    expect(active.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(active);
    expect(onToggle).toHaveBeenCalledWith('critical');
  });

  it('the hero total clears the active severity filter (show all)', () => {
    const onToggle = jest.fn();
    render(
      <FindingsStats
        findings={[f({ severity: 'critical' }), f({ severity: 'minor' })]}
        activeSeverity="critical"
        onToggleSeverity={onToggle}
      />,
    );
    // "2 findings" hero → clicking it while filtered clears the filter (toggles
    // the active severity off).
    fireEvent.click(screen.getByText('findings').closest('button')!);
    expect(onToggle).toHaveBeenCalledWith('critical');
  });

  it('the hero total is disabled (non-clickable) when already showing all', () => {
    const onToggle = jest.fn();
    render(
      <FindingsStats
        findings={[f({ severity: 'critical' }), f({ severity: 'minor' })]}
        activeSeverity={null}
        onToggleSeverity={onToggle}
      />,
    );
    const hero = screen.getByText('findings').closest('button')!;
    expect(hero.hasAttribute('disabled')).toBe(true);
  });
});
