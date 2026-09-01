/** Regression: the hook must not re-add a posted date for HigherGov. */
jest.mock('@/lib/env', () => ({ env: { BASE_API_URL: 'http://test-api.com' } }));
const mockFetcher = jest.fn();
jest.mock('@/lib/auth/auth-fetcher', () => ({ authFetcher: (...a: unknown[]) => mockFetcher(...a) }));

import { renderHook, act } from '@testing-library/react';
import { useSearchOpportunities } from '@/lib/hooks/use-search-opportunities';

const body = () => JSON.parse((mockFetcher.mock.calls[0][1] as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
  mockFetcher.mockResolvedValue({ ok: true, json: async () => ({ opportunities: [], total: 0 }) });
});

it('omits posted dates entirely for a HigherGov-only search', async () => {
  const { result } = renderHook(() => useSearchOpportunities('org-1'));
  await act(async () => { await result.current.search({ sources: ['HIGHER_GOV'], keywords: 'saas' }); });
  expect(body().postedFrom).toBeUndefined();
  expect(body().postedTo).toBeUndefined();
  expect(body().keywords).toBe('saas');
});

it('still defaults a 30-day range for SAM.gov, which requires one', async () => {
  const { result } = renderHook(() => useSearchOpportunities('org-1'));
  await act(async () => { await result.current.search({ sources: ['SAM_GOV'], keywords: 'radar' }); });
  expect(body().postedFrom).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  expect(body().postedTo).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
});

it('honours an explicitly chosen HigherGov posted day', async () => {
  const { result } = renderHook(() => useSearchOpportunities('org-1'));
  await act(async () => { await result.current.search({ sources: ['HIGHER_GOV'], keywords: 'saas', postedFrom: '2026-08-01' }); });
  expect(body().postedFrom).toBe('08/01/2026');
});
