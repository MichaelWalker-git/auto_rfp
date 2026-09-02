import { render, screen } from '@testing-library/react';
import { ApplyResultReport } from '../ApplyResultReport';
import type { EditApplyResult } from '@auto-rfp/core';

describe('ApplyResultReport', () => {
  it('leads with "All N changes applied" when everything applied', () => {
    render(
      <ApplyResultReport
        results={[
          { editId: 'a', status: 'applied', newVersionNumber: 3 },
          { editId: 'b', status: 'applied' },
        ]}
      />,
    );
    expect(screen.getByText(/All 2 changes applied/)).toBeTruthy();
  });

  it('summarizes a partial run and lists skip reasons (only when some applied)', () => {
    const results: EditApplyResult[] = [
      { editId: 'a', status: 'applied' },
      { editId: 'c', status: 'skipped-stale', message: 'changed since proposed' },
      { editId: 'd', status: 'failed', message: 'boom' },
    ];
    render(<ApplyResultReport results={results} />);
    expect(screen.getByText(/1 of 3 applied/)).toBeTruthy();
    expect(screen.getByText(/1 skipped/)).toBeTruthy();
    expect(screen.getByText(/1 failed/)).toBeTruthy();
    expect(screen.getByText(/changed since proposed/)).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
  });

  it('shows a clear "no changes applied — re-run" headline when everything is stale', () => {
    const results: EditApplyResult[] = Array.from({ length: 65 }, (_, i) => ({
      editId: `e${i}`,
      status: 'skipped-stale',
      message: 'Original text no longer present (changed since proposed)',
    }));
    render(<ApplyResultReport results={results} />);
    expect(screen.getByText(/No changes applied/)).toBeTruthy();
    expect(screen.getByText(/Re-run the edit/)).toBeTruthy();
    // The noisy per-item list is suppressed when nothing applied.
    expect(screen.queryByText(/Original text no longer present/)).toBeNull();
  });

  it('collapses repeated skip messages into a single "×N" line on a partial run', () => {
    const results: EditApplyResult[] = [
      { editId: 'a', status: 'applied' },
      { editId: 'b', status: 'skipped-stale', message: 'changed since proposed' },
      { editId: 'c', status: 'skipped-stale', message: 'changed since proposed' },
    ];
    render(<ApplyResultReport results={results} />);
    expect(screen.getByText(/changed since proposed \(×2\)/)).toBeTruthy();
  });

  it('shows a destructive "none applied — failed" headline when all fail', () => {
    render(
      <ApplyResultReport
        results={[
          { editId: 'a', status: 'failed', message: 'boom' },
          { editId: 'b', status: 'failed', message: 'boom' },
        ]}
      />,
    );
    expect(screen.getByText(/None applied — 2 failed/)).toBeTruthy();
    expect(screen.getByText(/boom \(×2\)/)).toBeTruthy();
  });
});
