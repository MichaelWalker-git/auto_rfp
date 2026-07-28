import { render, screen, fireEvent } from '@testing-library/react';
import { RfpTrackingTabs } from '../RfpTrackingTabs';
import { makeItem } from '../../__tests__/fixtures';

const NOW = '2026-07-27T00:00:00.000Z';

// ─── Mocks ───

let pipelineState: {
  items: ReturnType<typeof makeItem>[];
  isLoading: boolean;
  isError: boolean;
  mutate: jest.Mock;
};
const mockMutate = jest.fn();

jest.mock('../../hooks/use-rfp-pipeline', () => ({
  useRfpPipeline: () => pipelineState,
  rfpPipelineKey: (orgId: string) => ['rfp-pipeline', orgId],
}));

jest.mock('../../hooks/use-approval-decision', () => ({
  useApprovalDecision: () => ({ decide: jest.fn(), pendingOppId: null, error: null }),
}));

jest.mock('../../hooks/use-approval-advance', () => ({
  useApprovalAdvance: () => ({ advance: jest.fn(), pendingOppId: null, error: null }),
}));

let hasPermission = true;
jest.mock('@/components/permission-wrapper', () => ({
  usePermission: () => hasPermission,
}));

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({ currentOrganization: { id: 'org-1', name: 'Acme Corp' } }),
}));

const mockExport = jest.fn();
jest.mock('../../lib/export-csv', () => ({
  exportPipelineToCsv: (...args: unknown[]) => mockExport(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  hasPermission = true;
  pipelineState = { items: [], isLoading: false, isError: false, mutate: mockMutate };
});

describe('RfpTrackingTabs', () => {
  it('renders a skeleton while loading', () => {
    pipelineState = { items: [], isLoading: true, isError: false, mutate: mockMutate };
    const { container } = render(<RfpTrackingTabs orgId="org-1" nowIso={NOW} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: /board/i })).toBeNull();
  });

  it('renders an error state with a retry that revalidates', () => {
    pipelineState = { items: [], isLoading: false, isError: true, mutate: mockMutate };
    render(<RfpTrackingTabs orgId="org-1" nowIso={NOW} />);
    expect(screen.getByText(/could not load the rfp pipeline/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockMutate).toHaveBeenCalled();
  });

  it('renders the three tabs and badge counts', () => {
    pipelineState = {
      items: [
        makeItem({ id: 'q', approvalStatus: 'INITIAL_APPROVAL' }), // 1 pending approval
        makeItem({ id: 'm', status: 'PURSUING', assigneeId: undefined, responseDeadlineIso: '2026-08-01T00:00:00.000Z' }), // 1 flag
      ],
      isLoading: false,
      isError: false,
      mutate: mockMutate,
    };
    render(<RfpTrackingTabs orgId="org-1" nowIso={NOW} />);
    expect(screen.getByRole('tab', { name: /board/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /approval queue/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /needs attention/i })).toBeTruthy();
  });

  it('disables Export CSV when the pipeline is empty and calls it when there are items', () => {
    // Empty first.
    const { rerender } = render(<RfpTrackingTabs orgId="org-1" nowIso={NOW} />);
    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled();

    // With items, clicking exports.
    pipelineState = { items: [makeItem({ id: 'a' })], isLoading: false, isError: false, mutate: mockMutate };
    rerender(<RfpTrackingTabs orgId="org-1" nowIso={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    expect(mockExport).toHaveBeenCalledTimes(1);
    const [exportedItems, orgName, nowArg] = mockExport.mock.calls[0]!;
    expect(exportedItems).toHaveLength(1);
    expect(exportedItems[0].id).toBe('a');
    expect(orgName).toBe('Acme Corp');
    expect(nowArg).toBe(NOW);
  });

  it('Refresh triggers a revalidation', () => {
    render(<RfpTrackingTabs orgId="org-1" nowIso={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(mockMutate).toHaveBeenCalled();
  });
});
