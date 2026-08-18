import { renderHook } from '@testing-library/react';
import type { KBCoverageResponse } from '@auto-rfp/core';
import { useKBCoverage } from '../useKBCoverage';

const mockUseSWR = jest.fn();
jest.mock('swr', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

jest.mock('@/lib/env', () => ({ env: { BASE_API_URL: 'https://api.test' } }));
jest.mock('@/lib/auth/auth-fetcher', () => ({ authFetcher: jest.fn() }));

const response = (over: Partial<KBCoverageResponse> = {}): KBCoverageResponse => ({
  snapshot: {
    PERSONNEL_BIOS: { present: false, count: 0 },
    CERTIFICATIONS: { present: true, count: 3 },
    INSURANCE: { present: false, count: 0 },
  },
  byDocumentType: {
    TEAM_QUALIFICATIONS: {
      covered: false,
      missing: [{ key: 'PERSONNEL_BIOS', label: 'personnel bios' }],
    },
    CERTIFICATIONS: { covered: true, missing: [] },
  },
  isGateEnabled: false,
  ...over,
});

const loaded = (over: Partial<KBCoverageResponse> = {}) => {
  mockUseSWR.mockReturnValue({ data: response(over), error: undefined, isLoading: false });
};

beforeEach(() => {
  jest.clearAllMocks();
  loaded();
});

const render = (orgId: string | undefined = 'org-1') =>
  renderHook(() => useKBCoverage(orgId)).result;

/** Explicit `undefined` — a default parameter would swallow it. */
const renderWithoutOrg = () => renderHook(() => useKBCoverage(undefined)).result;

describe('useKBCoverage', () => {
  it('fetches the org-scoped snapshot once for every document type', () => {
    render();

    expect(mockUseSWR).toHaveBeenCalledTimes(1);
    expect(mockUseSWR.mock.calls[0][0]).toBe(
      'https://api.test/rfp-document/kb-coverage?orgId=org-1',
    );
  });

  it('does not fetch without an orgId', () => {
    renderWithoutOrg();

    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
  });

  it('reports which document types have KB requirements', () => {
    const result = render();

    expect(result.current.hasRequirements('TEAM_QUALIFICATIONS')).toBe(true);
    expect(result.current.hasRequirements('COVER_LETTER')).toBe(false);
    expect(result.current.hasRequirements('MY_CUSTOM_TYPE')).toBe(false);
  });

  it('names the missing categories for an uncovered type', () => {
    const result = render();

    expect(result.current.getStatus('TEAM_QUALIFICATIONS').covered).toBe(false);
    expect(result.current.getMissing('TEAM_QUALIFICATIONS')).toEqual([
      { key: 'PERSONNEL_BIOS', label: 'personnel bios' },
    ]);
    expect(result.current.getMissing('CERTIFICATIONS')).toEqual([]);
  });

  it('treats a type the server said nothing about as covered', () => {
    const result = render();

    // Never invent a gap the server hasn't confirmed.
    expect(result.current.getStatus('COVER_LETTER')).toEqual({ covered: true, missing: [] });
    expect(result.current.getMissing('MY_CUSTOM_TYPE')).toEqual([]);
  });

  it('warns but does not block when the org gate is off', () => {
    const result = render();

    expect(result.current.isGateEnabled).toBe(false);
    expect(result.current.getMissing('TEAM_QUALIFICATIONS')).toHaveLength(1);
    expect(result.current.isDocumentTypeBlocked('TEAM_QUALIFICATIONS')).toBe(false);
  });

  it('blocks an uncovered type only when the org gate is armed', () => {
    loaded({ isGateEnabled: true });

    const result = render();

    expect(result.current.isDocumentTypeBlocked('TEAM_QUALIFICATIONS')).toBe(true);
    expect(result.current.isDocumentTypeBlocked('CERTIFICATIONS')).toBe(false);
    expect(result.current.isDocumentTypeBlocked('COVER_LETTER')).toBe(false);
  });

  it('never blocks while the probe is in flight — the server 409 is the backstop', () => {
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: true });

    const result = render();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isGateEnabled).toBe(false);
    expect(result.current.isDocumentTypeBlocked('TEAM_QUALIFICATIONS')).toBe(false);
    expect(result.current.getMissing('TEAM_QUALIFICATIONS')).toEqual([]);
    expect(result.current.snapshot).toEqual({});
  });

  it('never blocks when the probe fails', () => {
    const error = Object.assign(new Error('boom'), { status: 500 });
    mockUseSWR.mockReturnValue({ data: undefined, error, isLoading: false });

    const result = render();

    expect(result.current.error).toBe(error);
    expect(result.current.isDocumentTypeBlocked('TEAM_QUALIFICATIONS')).toBe(false);
  });

  // `getMissing` returning [] is ambiguous — "nothing missing" vs "don't know".
  // `hasVerdict` is what lets a consumer tell them apart, so a badge never
  // claims "KB ready" on an unanswered probe.
  describe('hasVerdict', () => {
    it('is true once the server has answered', () => {
      expect(render().current.hasVerdict).toBe(true);
    });

    it('is false while the probe is in flight', () => {
      mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: true });

      expect(render().current.hasVerdict).toBe(false);
    });

    it('is false when the probe failed', () => {
      mockUseSWR.mockReturnValue({
        data: undefined,
        error: Object.assign(new Error('boom'), { status: 500 }),
        isLoading: false,
      });

      expect(render().current.hasVerdict).toBe(false);
    });

    it('is false with no orgId to probe', () => {
      mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: false });

      expect(renderWithoutOrg().current.hasVerdict).toBe(false);
    });
  });

  it('exposes the raw snapshot for the KB-owner view', () => {
    const result = render();

    expect(result.current.snapshot.CERTIFICATIONS).toEqual({ present: true, count: 3 });
    expect(result.current.snapshot.PERSONNEL_BIOS).toEqual({ present: false, count: 0 });
  });
});
