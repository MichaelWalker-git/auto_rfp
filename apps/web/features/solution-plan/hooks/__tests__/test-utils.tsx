import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';

export const mockApiFetcher = jest.fn();
export const mockApiMutate = jest.fn();

/**
 * Shared factory for `jest.mock('@/lib/hooks/api-helpers', ...)` in the hook
 * tests. Usage:
 *
 *   jest.mock('@/lib/hooks/api-helpers', () => require('./test-utils').apiHelpersMock);
 */
export const apiHelpersMock = {
  apiFetcher: (...args: unknown[]) => mockApiFetcher(...args),
  apiMutate: (...args: unknown[]) => mockApiMutate(...args),
  buildApiUrl: (path: string, params?: Record<string, string>) =>
    `https://api.test/${path}?${new URLSearchParams(params).toString()}`,
};

/** renderHook wrapper giving each test an isolated SWR cache. */
export const swrWrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);
