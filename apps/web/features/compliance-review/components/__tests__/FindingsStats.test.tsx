import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('No active findings.')).toBeTruthy();
  });

  it('shows the total count (pluralized)', () => {
    render(<FindingsStats findings={[f({}), f({}), f({})]} />);
    expect(screen.getByText('3 findings')).toBeTruthy();
  });

  it('uses the singular for one finding', () => {
    render(<FindingsStats findings={[f({})]} />);
    expect(screen.getByText('1 finding')).toBeTruthy();
  });

  it('breaks findings down by issue type with human labels', () => {
    render(
      <FindingsStats
        findings={[
          f({ issueType: 'MISSING_FORM' }),
          f({ issueType: 'MISSING_FORM' }),
          f({ issueType: 'INCORRECT_ANSWER' }),
        ]}
      />,
    );
    // Sorted by count desc: 2 missing forms first, then 1 incorrect answer.
    expect(screen.getByText('2 missing forms, 1 incorrect answers')).toBeTruthy();
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
    expect(screen.getByText('2 critical')).toBeTruthy();
    expect(screen.getByText('1 info')).toBeTruthy();
  });
});
