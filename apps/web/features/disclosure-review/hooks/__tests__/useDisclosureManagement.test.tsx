import { renderHook, act, waitFor } from '@testing-library/react';
import type { PastProject } from '@auto-rfp/core';

const mockConfirmTrigger = jest.fn();
const mockClassifyTrigger = jest.fn();
const mockToast = jest.fn();
const mockGlobalMutate = jest.fn();

jest.mock('../useConfirmDisclosure', () => ({
  useConfirmDisclosure: () => ({ trigger: mockConfirmTrigger, isLoading: false, error: undefined }),
}));
jest.mock('../useClassifyDisclosure', () => ({
  useClassifyDisclosure: () => ({ trigger: mockClassifyTrigger, isLoading: false, error: undefined }),
}));
jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('swr', () => ({ mutate: (...args: unknown[]) => mockGlobalMutate(...args) }));

import { useDisclosureManagement } from '../useDisclosureManagement';

const makeProject = (over: Partial<PastProject> = {}): PastProject =>
  ({
    projectId: 'p1',
    orgId: 'org-1',
    title: 'Cloud Migration',
    client: 'Acme Federal',
    disclosure: 'PERMISSION_REQUIRED',
    disclosureConfirmed: false,
    disclosureContactNote: null,
    ...over,
  }) as PastProject;

beforeEach(() => {
  jest.clearAllMocks();
  mockConfirmTrigger.mockResolvedValue({ confirmed: 1 });
  mockClassifyTrigger.mockResolvedValue({ classified: 2, failed: [] });
});

describe('useDisclosureManagement', () => {
  it('pre-selects the AI proposal for unconfirmed rows', () => {
    const projects = [makeProject({ disclosureProposed: 'NAMEABLE' })];
    const { result } = renderHook(() => useDisclosureManagement({ orgId: 'org-1', projects }));

    expect(result.current.getLevel(projects[0])).toBe('NAMEABLE');
    expect(result.current.isDirty(projects[0])).toBe(false);
  });

  it('pre-selects the confirmed value (not the stale proposal) for confirmed rows', () => {
    const projects = [
      makeProject({ disclosure: 'ANONYMIZED_ONLY', disclosureConfirmed: true, disclosureProposed: 'NAMEABLE' }),
    ];
    const { result } = renderHook(() => useDisclosureManagement({ orgId: 'org-1', projects }));

    expect(result.current.getLevel(projects[0])).toBe('ANONYMIZED_ONLY');
  });

  it('marks a row dirty once the reviewer changes it and counts it', () => {
    const projects = [makeProject()];
    const { result } = renderHook(() => useDisclosureManagement({ orgId: 'org-1', projects }));

    act(() => result.current.setLevel('p1', 'NAMEABLE'));

    expect(result.current.isDirty(projects[0])).toBe(true);
    expect(result.current.dirtyCount).toBe(1);
  });

  it('saveOne confirms only that row and preserves the existing contact note', async () => {
    const projects = [makeProject({ disclosureContactNote: 'call PM first' })];
    const { result } = renderHook(() => useDisclosureManagement({ orgId: 'org-1', projects }));

    act(() => result.current.setLevel('p1', 'DO_NOT_USE'));
    await act(async () => {
      await result.current.saveOne(projects[0]);
    });

    expect(mockConfirmTrigger).toHaveBeenCalledWith({
      orgId: 'org-1',
      rows: [{ projectId: 'p1', disclosure: 'DO_NOT_USE', disclosureContactNote: 'call PM first' }],
    });
    expect(mockGlobalMutate).toHaveBeenCalled();
  });

  it('saveAll only sends rows the reviewer actually changed', async () => {
    const projects = [
      makeProject({ projectId: 'p1' }),
      makeProject({ projectId: 'p2', disclosureProposed: 'NAMEABLE' }),
    ];
    const { result } = renderHook(() => useDisclosureManagement({ orgId: 'org-1', projects }));

    act(() => result.current.setLevel('p1', 'NAMEABLE'));
    await act(async () => {
      await result.current.saveAll();
    });

    expect(mockConfirmTrigger).toHaveBeenCalledTimes(1);
    expect(mockConfirmTrigger).toHaveBeenCalledWith({
      orgId: 'org-1',
      rows: [{ projectId: 'p1', disclosure: 'NAMEABLE', disclosureContactNote: null }],
    });
  });

  it('markAllAs makes differing rows dirty so saveAll sweeps them in', async () => {
    const projects = [makeProject({ projectId: 'p1' }), makeProject({ projectId: 'p2' })];
    const { result } = renderHook(() => useDisclosureManagement({ orgId: 'org-1', projects }));

    act(() => result.current.markAllAs('DO_NOT_USE'));
    expect(result.current.dirtyCount).toBe(2);

    await act(async () => {
      await result.current.saveAll();
    });
    expect(mockConfirmTrigger).toHaveBeenCalledWith({
      orgId: 'org-1',
      rows: [
        { projectId: 'p1', disclosure: 'DO_NOT_USE', disclosureContactNote: null },
        { projectId: 'p2', disclosure: 'DO_NOT_USE', disclosureContactNote: null },
      ],
    });
  });

  it('saveAll does nothing when no row is dirty', async () => {
    const projects = [makeProject()];
    const { result } = renderHook(() => useDisclosureManagement({ orgId: 'org-1', projects }));

    await act(async () => {
      await result.current.saveAll();
    });
    expect(mockConfirmTrigger).not.toHaveBeenCalled();
  });

  it('classifyAll triggers the backfill and clears edits', async () => {
    const projects = [makeProject()];
    const { result } = renderHook(() => useDisclosureManagement({ orgId: 'org-1', projects }));

    act(() => result.current.setLevel('p1', 'NAMEABLE'));
    await act(async () => {
      await result.current.classifyAll();
    });

    expect(mockClassifyTrigger).toHaveBeenCalledWith({ orgId: 'org-1', force: false });
    await waitFor(() => expect(result.current.dirtyCount).toBe(0));
  });

  it('enter/exit toggles management mode and exit clears edits', () => {
    const projects = [makeProject()];
    const { result } = renderHook(() => useDisclosureManagement({ orgId: 'org-1', projects }));

    act(() => result.current.enter());
    expect(result.current.isActive).toBe(true);

    act(() => result.current.setLevel('p1', 'NAMEABLE'));
    act(() => result.current.exit());

    expect(result.current.isActive).toBe(false);
    expect(result.current.dirtyCount).toBe(0);
  });
});
