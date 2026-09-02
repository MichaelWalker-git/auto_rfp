import { render, screen } from '@testing-library/react';
import type { KBCoverageDocumentTypeStatus } from '@auto-rfp/core';
import type { KBCoverage } from '../../hooks/useKBCoverage';
import { coverageState } from '../../testing';
import { KBCoverageDashboard } from '../KBCoverageDashboard';

const mockUseKBCoverage = jest.fn();
jest.mock('../../hooks/useKBCoverage', () => ({
  useKBCoverage: (...args: unknown[]) => mockUseKBCoverage(...args),
}));

const uncovered: Record<string, KBCoverageDocumentTypeStatus> = {
  TEAM_QUALIFICATIONS: {
    covered: false,
    missing: [
      { key: 'PERSONNEL_BIOS', label: 'personnel bios' },
      { key: 'CERTIFICATIONS', label: 'certification records' },
    ],
  },
  CERTIFICATIONS: { covered: true, missing: [] },
};

// Built on the shared factory rather than a local literal, so a new field on
// `KBCoverage` is a type error here instead of silently defaulting to undefined.
const coverage = (over: Partial<KBCoverage> = {}): KBCoverage =>
  coverageState({
    snapshot: {
      PERSONNEL_BIOS: { present: false, count: 0 },
      CERTIFICATIONS: { present: true, count: 4 },
      INSURANCE: { present: false, count: 0 },
    },
    hasRequirements: () => true,
    getStatus: (documentType: string) =>
      uncovered[documentType] ?? { covered: true, missing: [] },
    getMissing: (documentType: string) => (uncovered[documentType] ?? { missing: [] }).missing,
    ...over,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockUseKBCoverage.mockReturnValue(coverage());
});

describe('KBCoverageDashboard', () => {
  it('lists every missing category across document types for the org', () => {
    render(<KBCoverageDashboard orgId="org-1" />);

    expect(screen.getByText('personnel bios, certification records')).toBeTruthy();
    expect(screen.getByText('Team Qualifications')).toBeTruthy();
    expect(screen.getByText('Gap')).toBeTruthy();
    expect(screen.getByText('Covered')).toBeTruthy();
  });

  it('shows what the knowledge base holds today, with counts', () => {
    render(<KBCoverageDashboard orgId="org-1" />);

    expect(screen.getByText(/certification records \(4\)/)).toBeTruthy();
    expect(screen.getByText(/personnel bios — none/)).toBeTruthy();
    // The probe answers "is anything filed here", not "is it usable" — say so.
    expect(screen.getByText(/not that it is complete or current/)).toBeTruthy();
  });

  it('says gaps are warnings only when the org gate is off', () => {
    render(<KBCoverageDashboard orgId="org-1" />);

    expect(screen.getByText(/generation is not blocked in this organization/)).toBeTruthy();
    expect(screen.queryByText('Blocked')).toBeNull();
  });

  it('says generation is blocked when the org gate is armed', () => {
    mockUseKBCoverage.mockReturnValue(coverage({ isGateEnabled: true }));

    render(<KBCoverageDashboard orgId="org-1" />);

    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(
      screen.getByText(/Generation is blocked for uncovered types in this organization/),
    ).toBeTruthy();
  });

  // Caught on a real org (Horus Technology, fully covered): the gate-mode sentence
  // used to append unconditionally, so the page said "every document type is
  // covered" and then warned about gaps in the same breath.
  it('says nothing about gaps when there are none', () => {
    mockUseKBCoverage.mockReturnValue(
      coverage({ getStatus: () => ({ covered: true, missing: [] }), getMissing: () => [] }),
    );

    render(<KBCoverageDashboard orgId="org-1" />);

    expect(
      screen.getByText(/Every document type with knowledge base requirements is covered/),
    ).toBeTruthy();
    expect(screen.queryByText(/generation is not blocked in this organization/)).toBeNull();
    expect(screen.queryByText(/cannot be fully grounded/)).toBeNull();
  });

  it('still states the blocking mode when an armed org has a real gap', () => {
    mockUseKBCoverage.mockReturnValue(coverage({ isGateEnabled: true }));

    render(<KBCoverageDashboard orgId="org-1" />);

    // The default `coverage()` factory has TEAM_QUALIFICATIONS uncovered, so the
    // mode sentence must survive the fix above.
    expect(screen.getByText(/cannot be fully grounded/)).toBeTruthy();
    expect(
      screen.getByText(/Generation is blocked for uncovered types in this organization/),
    ).toBeTruthy();
  });

  it('renders skeletons, not a spinner, while loading', () => {
    mockUseKBCoverage.mockReturnValue(coverage({ isLoading: true }));

    const { container } = render(<KBCoverageDashboard orgId="org-1" />);

    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.textContent).not.toContain('Loading');
  });

  it('surfaces a probe failure instead of implying full coverage', () => {
    mockUseKBCoverage.mockReturnValue(
      coverage({ error: Object.assign(new Error('probe exploded'), { status: 500 }) }),
    );

    render(<KBCoverageDashboard orgId="org-1" />);

    expect(screen.getByText(/probe exploded/)).toBeTruthy();
    expect(screen.queryByText('Covered')).toBeNull();
  });

  it('never reports full coverage from a settled response that carries no verdict', () => {
    // A 200 with an empty body leaves SWR with data=null, isLoading=false and no
    // error — every guard falls through and getStatus answers COVERED for every
    // type. This view is the only place the gap is surfaced, so a false "all
    // covered" here is invisible to the KB owner.
    mockUseKBCoverage.mockReturnValue(
      coverage({ hasVerdict: false, isLoading: false, error: undefined }),
    );

    render(<KBCoverageDashboard orgId="org-1" />);

    expect(screen.queryByText('Covered')).toBeNull();
    expect(
      screen.queryByText(/Every document type with knowledge base requirements is covered/),
    ).toBeNull();
    expect(screen.getByText(/Coverage is unknown/)).toBeTruthy();
  });

  it('passes the org through to the hook', () => {
    render(<KBCoverageDashboard orgId="org-42" />);

    expect(mockUseKBCoverage).toHaveBeenCalledWith('org-42');
  });
});
