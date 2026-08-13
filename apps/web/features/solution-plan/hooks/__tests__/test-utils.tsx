import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import type { SolutionPlanHtmlContentResponse } from '@auto-rfp/core';

export const mockApiFetcher = jest.fn();
export const mockApiMutate = jest.fn();

/** Canonical GET /solution-plan/html-content body shared by hook and component tests. */
export const makeHtmlContentResponse = (
  over: Partial<SolutionPlanHtmlContentResponse> = {},
): SolutionPlanHtmlContentResponse => ({
  ok: true,
  html: '<h1>Solution Plan</h1>',
  contentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
  version: 2,
  isStale: false,
  isUserEdited: false,
  ...over,
});

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
