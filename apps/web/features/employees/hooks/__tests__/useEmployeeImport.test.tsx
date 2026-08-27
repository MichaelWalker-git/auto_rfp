// Mock SWR and the API layer before importing the hook.
jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(),
  mutate: jest.fn(),
}));
jest.mock('swr/mutation', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/lib/hooks/api-helpers', () => ({
  apiFetcher: jest.fn(),
  apiMutate: jest.fn(),
  buildApiUrl: jest.fn(
    (path: string, params?: Record<string, unknown>) =>
      `/${path}${params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : ''}`,
  ),
}));

import { renderHook } from '@testing-library/react';
import useSWR, { mutate } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { EmployeeImportRunItem } from '@auto-rfp/core';
import { useEmployeeImport } from '../useEmployeeImport';
import { employeesListKey } from '../useEmployees';

const mockUseSWR = useSWR as jest.MockedFunction<typeof useSWR>;
const mockUseSWRMutation = useSWRMutation as jest.MockedFunction<typeof useSWRMutation>;
const mockGlobalMutate = mutate as jest.MockedFunction<typeof mutate>;

const makeRun = (overrides: Partial<EmployeeImportRunItem> = {}): EmployeeImportRunItem => ({
  importRunId: 'run-1',
  orgId: 'org-1',
  status: 'RUNNING',
  documentsScanned: 2,
  cvsDetected: 1,
  employeesCreated: 1,
  employeesUpdated: 0,
  failedDocuments: [],
  triggeredBy: 'user-1',
  startedAt: '2026-08-19T10:00:00.000Z',
  ...overrides,
});

const swrState = (run: EmployeeImportRunItem | null) =>
  ({
    data: { run },
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: jest.fn(),
  }) as unknown as ReturnType<typeof useSWR>;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSWRMutation.mockReturnValue({
    trigger: jest.fn(),
    isMutating: false,
    error: undefined,
    reset: jest.fn(),
    data: undefined,
  } as unknown as ReturnType<typeof useSWRMutation>);
});

describe('useEmployeeImport', () => {
  it('reports isRunning and polls while the run is RUNNING (BR5.1)', () => {
    mockUseSWR.mockReturnValue(swrState(makeRun()));

    const { result } = renderHook(() => useEmployeeImport('org-1'));

    expect(result.current.isRunning).toBe(true);
    expect(result.current.run?.importRunId).toBe('run-1');

    // The poll interval is a function: RUNNING → interval, terminal → 0.
    const options = mockUseSWR.mock.calls[0][2] as {
      refreshInterval: (latest?: { run: EmployeeImportRunItem | null }) => number;
    };
    expect(options.refreshInterval({ run: makeRun() })).toBeGreaterThan(0);
    expect(options.refreshInterval({ run: makeRun({ status: 'COMPLETED' }) })).toBe(0);
    expect(options.refreshInterval(undefined)).toBe(0);
  });

  it('revalidates the employee list when the run transitions RUNNING → terminal (W1 step 6)', () => {
    mockUseSWR.mockReturnValue(swrState(makeRun()));
    const { rerender } = renderHook(() => useEmployeeImport('org-1'));
    expect(mockGlobalMutate).not.toHaveBeenCalled();

    mockUseSWR.mockReturnValue(swrState(makeRun({ status: 'COMPLETED_WITH_ERRORS' })));
    rerender();

    expect(mockGlobalMutate).toHaveBeenCalledWith(employeesListKey('org-1'));
  });

  it('does not revalidate the list when the latest run was already terminal on load', () => {
    mockUseSWR.mockReturnValue(swrState(makeRun({ status: 'COMPLETED' })));
    const { rerender } = renderHook(() => useEmployeeImport('org-1'));
    rerender();

    expect(mockGlobalMutate).not.toHaveBeenCalled();
  });
});
