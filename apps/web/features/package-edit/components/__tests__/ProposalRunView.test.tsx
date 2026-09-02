import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ProposedEdit } from '@auto-rfp/core';

const proposals: ProposedEdit[] = [
  {
    editId: 'e1',
    target: { kind: 'RFP_DOCUMENT', documentId: 'doc-1', documentTitle: 'Cost' },
    before: 'the total is $2.0M',
    after: 'the total is $2.4M',
    rationale: 'align',
    advisoryOnly: false,
  },
  {
    editId: 'e2',
    target: { kind: 'FORM', formId: 'form-1', formTitle: 'Pricing', fieldId: 'fld-1', fieldLabel: 'Total' },
    before: '$2.0M',
    after: '$2.4M',
    rationale: 'align',
    advisoryOnly: false,
  },
];

const mockApplyEdits = jest.fn();
const mockRefresh = jest.fn();
const mockResetResults = jest.fn();
let mockResults: unknown = null;
let mockAppliedEditIds: string[] = [];
let mockRunId = 'run-1';
let mockStatus = 'PROPOSED';
let mockStartedAt: string | undefined;

jest.mock('../../hooks/usePackageEditRun', () => ({
  usePackageEditRun: () => ({
    run: {
      runId: mockRunId,
      status: mockStatus,
      proposals,
      appliedEditIds: mockAppliedEditIds,
      startedAt: mockStartedAt,
    },
    proposals,
    status: mockStatus,
    stale: false,
    isProposing: mockStatus === 'PROPOSING',
    isLoading: false,
    refresh: mockRefresh,
  }),
}));
jest.mock('../../hooks/useApplyEdits', () => ({
  useApplyEdits: () => ({
    applyEdits: mockApplyEdits,
    isApplying: false,
    results: mockResults,
    resetResults: mockResetResults,
  }),
}));

import { ProposalRunView } from '../ProposalRunView';

const props = { orgId: 'o', projectId: 'p', oppId: 'opp' };

beforeEach(() => {
  jest.clearAllMocks();
  mockResults = null;
  mockAppliedEditIds = [];
  mockRunId = 'run-1';
  mockStatus = 'PROPOSED';
  mockStartedAt = undefined;
  mockApplyEdits.mockResolvedValue([
    { editId: 'e1', status: 'applied', newVersionNumber: 2 },
    { editId: 'e2', status: 'applied', newVersionNumber: 1 },
  ]);
});

describe('ProposalRunView — clears stale results on a new run', () => {
  it('resets the apply report when run.runId changes (new edit request)', () => {
    const { rerender } = render(<ProposalRunView {...props} />);
    // Initial mount also resets once; clear to isolate the run-change reset.
    mockResetResults.mockClear();

    mockRunId = 'run-2'; // a NEW edit request produced a new run
    rerender(<ProposalRunView {...props} />);

    expect(mockResetResults).toHaveBeenCalled();
  });
});

describe('ProposalRunView — apply & resolve', () => {
  it('does NOT show the resolve button without onResolveFinding', () => {
    render(<ProposalRunView {...props} />);
    expect(screen.getByRole('button', { name: /^Apply 2 edits$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /resolve finding/i })).toBeNull();
  });

  it('shows "Apply & resolve finding" when onResolveFinding is provided', () => {
    render(<ProposalRunView {...props} onResolveFinding={jest.fn()} />);
    expect(screen.getByRole('button', { name: /apply & resolve finding/i })).toBeTruthy();
  });

  it('plain apply does not resolve the finding', async () => {
    const onResolve = jest.fn();
    render(<ProposalRunView {...props} onResolveFinding={onResolve} />);
    fireEvent.click(screen.getByRole('button', { name: /^Apply 2 edits$/ }));
    await waitFor(() => expect(mockApplyEdits).toHaveBeenCalledWith('run-1', ['e1', 'e2']));
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('"Apply & resolve" resolves the finding when at least one edit applied', async () => {
    const onResolve = jest.fn();
    render(<ProposalRunView {...props} onResolveFinding={onResolve} />);
    fireEvent.click(screen.getByRole('button', { name: /apply & resolve finding/i }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
  });

  it('"Apply & resolve" does NOT resolve when every edit skipped/failed', async () => {
    mockApplyEdits.mockResolvedValueOnce([
      { editId: 'e1', status: 'skipped-stale' },
      { editId: 'e2', status: 'skipped-stale' },
    ]);
    const onResolve = jest.fn();
    render(<ProposalRunView {...props} onResolveFinding={onResolve} />);
    fireEvent.click(screen.getByRole('button', { name: /apply & resolve finding/i }));
    await waitFor(() => expect(mockApplyEdits).toHaveBeenCalled());
    expect(onResolve).not.toHaveBeenCalled();
  });
});

describe('ProposalRunView — in-progress (PROPOSING) states', () => {
  it('shows a prominent "analyzing in the background" pending indicator while PROPOSING', () => {
    mockStatus = 'PROPOSING';
    mockStartedAt = new Date().toISOString(); // just started
    render(<ProposalRunView {...props} />);
    expect(screen.getByText(/analyzing the package for changes/i)).toBeTruthy();
    expect(screen.getByText(/runs in the background/i)).toBeTruthy();
    // Not the stuck/failed messaging yet.
    expect(screen.queryByText(/taking longer than expected/i)).toBeNull();
  });

  it('shows a "taking longer / may have failed" state after the stuck threshold', () => {
    mockStatus = 'PROPOSING';
    // Started 10 minutes ago → past the 5-min stuck bound.
    mockStartedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    render(<ProposalRunView {...props} onDiscard={jest.fn()} />);
    expect(screen.getByText(/taking longer than expected and may have failed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /check again/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /discard/i })).toBeTruthy();
  });

  it('shows the FAILED state with the run error', () => {
    mockStatus = 'FAILED';
    render(<ProposalRunView {...props} />);
    // Falls back to the generic failed message (mock run has no error field).
    expect(screen.getByText(/proposal scan failed/i)).toBeTruthy();
  });
});

describe('ProposalRunView — select all / deselect all', () => {
  it('defaults to all selected and offers "Deselect all"', () => {
    render(<ProposalRunView {...props} />);
    expect(screen.getByText('2 of 2 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /deselect all/i })).toBeTruthy();
  });

  it('"Deselect all" clears every selection and disables Apply', () => {
    render(<ProposalRunView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /deselect all/i }));
    expect(screen.getByText('0 of 2 selected')).toBeTruthy();
    // Toggle now offers "Select all", and Apply is disabled with nothing selected.
    expect(screen.getByRole('button', { name: /select all/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Apply/ }).hasAttribute('disabled')).toBe(true);
  });

  it('"Select all" re-selects every proposal after deselecting', () => {
    render(<ProposalRunView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /deselect all/i }));
    fireEvent.click(screen.getByRole('button', { name: /select all/i }));
    expect(screen.getByText('2 of 2 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Apply 2 edits$/ })).toBeTruthy();
  });

  it('cherry-pick flow: deselect all, then check one → applies only that one', async () => {
    render(<ProposalRunView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /deselect all/i }));
    // Re-check the first proposal's checkbox.
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText('1 of 2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Apply 1 edit$/ }));
    await waitFor(() => expect(mockApplyEdits).toHaveBeenCalledWith('run-1', ['e1']));
  });

  it('W1: a revalidation re-render does NOT re-select after Deselect all (same runId)', () => {
    const { rerender } = render(<ProposalRunView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /deselect all/i }));
    expect(screen.getByText('0 of 2 selected')).toBeTruthy();

    // Simulate SWR revalidation (reconnect/focus/poll): same runId, re-render with
    // a fresh proposals array identity. The default-select effect must NOT refire.
    rerender(<ProposalRunView {...props} />);
    expect(screen.getByText('0 of 2 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /select all/i })).toBeTruthy();
  });

  it('W1: a NEW run (runId change) DOES reset to all-selected', () => {
    const { rerender } = render(<ProposalRunView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /deselect all/i }));
    expect(screen.getByText('0 of 2 selected')).toBeTruthy();

    mockRunId = 'run-2'; // a new edit request
    rerender(<ProposalRunView {...props} />);
    expect(screen.getByText('2 of 2 selected')).toBeTruthy();
  });
});

describe('ProposalRunView — discard', () => {
  it('does NOT show a Discard button without onDiscard', () => {
    render(<ProposalRunView {...props} />);
    expect(screen.queryByRole('button', { name: /^discard$/i })).toBeNull();
  });

  it('shows Discard and calls onDiscard when clicked', () => {
    const onDiscard = jest.fn();
    render(<ProposalRunView {...props} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});

describe('ProposalRunView — remaining-after-applied filtering', () => {
  it('hides proposals already applied on the run and only offers the rest', () => {
    mockAppliedEditIds = ['e1'];
    render(<ProposalRunView {...props} />);
    // e1 already applied → only e2 remains selectable.
    expect(screen.getByRole('button', { name: /^Apply 1 edit$/ })).toBeTruthy();
    expect(screen.getByText(/1 of 1 selected/)).toBeTruthy();
  });

  it('shows an "all applied" message when every proposal is already applied', () => {
    mockAppliedEditIds = ['e1', 'e2'];
    render(<ProposalRunView {...props} />);
    expect(screen.getByText(/All proposed edits from this run have been applied/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull();
  });

  it('only sends the still-remaining editIds to apply', async () => {
    mockAppliedEditIds = ['e1'];
    render(<ProposalRunView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /^Apply 1 edit$/ }));
    await waitFor(() => expect(mockApplyEdits).toHaveBeenCalledWith('run-1', ['e2']));
  });
});
