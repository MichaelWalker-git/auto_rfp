import { render, screen } from '@testing-library/react';
import { KBCoverageBadge } from '../KBCoverageBadge';

describe('KBCoverageBadge', () => {
  it('names every missing category, in order', () => {
    render(
      <KBCoverageBadge
        missing={[
          { key: 'PERSONNEL_BIOS', label: 'personnel bios' },
          { key: 'CERTIFICATIONS', label: 'certification records' },
        ]}
      />,
    );

    expect(screen.getByText('Missing: personnel bios, certification records')).toBeTruthy();
  });

  it('reports readiness when nothing is missing', () => {
    render(<KBCoverageBadge missing={[]} />);

    expect(screen.getByText('KB ready')).toBeTruthy();
    expect(screen.queryByText(/Missing:/)).toBeNull();
  });

  it('shows the same named list whether the gate blocks or only warns', () => {
    const missing = [{ key: 'INSURANCE' as const, label: 'insurance documents' }];

    const { container: warning } = render(<KBCoverageBadge missing={missing} />);
    const { container: blocking } = render(<KBCoverageBadge missing={missing} isBlocking />);

    expect(warning.textContent).toContain('Missing: insurance documents');
    expect(blocking.textContent).toContain('Missing: insurance documents');
    // Only the tone differs — knowing the gap is the point either way.
    expect(warning.querySelector('.text-amber-700')).toBeTruthy();
    expect(blocking.querySelector('.text-destructive')).toBeTruthy();
  });
});
