'use client';

import useSWR, { SWRConfiguration, KeyedMutator } from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

// ─── Shared Error Class ───

export class ApiError extends Error {
  status?: number;
  details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

// ─── Shared Fetcher (GET) ───

export async function apiFetcher<T>(url: string): Promise<T> {
  const res = await authFetcher(url);

  if (!res.ok) {
    let details: unknown;
    try {
      details = await res.json();
    } catch {
      details = await res.text().catch(() => '');
    }
    throw new ApiError(
      `Request failed with status ${res.status}`,
      res.status,
      details,
    );
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// ─── Shared Mutator (POST/PUT/PATCH/DELETE) ───

export async function apiMutate<TResponse, TBody = unknown>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: TBody,
): Promise<TResponse> {
  const res = await authFetcher(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    let details: unknown;
    try {
      details = await res.json();
    } catch {
      details = await res.text().catch(() => '');
    }
    const message = typeof details === 'object' && details !== null && 'error' in details
      ? (details as { error: string }).error
      : typeof details === 'object' && details !== null && 'message' in details
        ? (details as { message: string }).message
        : `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, details);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : null) as TResponse;
}

// ─── Generic GET Hook ───

export interface UseApiResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: ApiError | undefined;
  mutate: KeyedMutator<T>;
}

const DEFAULT_SWR_CONFIG: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateIfStale: false,
  dedupingInterval: 60_000,
  focusThrottleInterval: 60_000,
  errorRetryCount: 3,
  loadingTimeout: 10_000,
};

export function useApi<T>(
  key: string | null | any[],
  url?: string | null,
  config?: SWRConfiguration,
): UseApiResult<T> {
  const { data, error, isLoading, mutate } = useSWR<T>(
    url ? key : null,
    url ? () => apiFetcher<T>(url) : null,
    { ...DEFAULT_SWR_CONFIG, ...config },
  );

  return {
    data,
    isLoading,
    isError: !!error,
    error: error as ApiError | undefined,
    mutate,
  };
}

// ─── Generic Mutation Hook Factory ───

export function useMutation<TResponse, TArg = void>(
  key: string,
  mutationFn: (url: string, arg: TArg) => Promise<TResponse>,
) {
  return useSWRMutation<TResponse, ApiError, string, TArg>(
    key,
    async (url, { arg }) => mutationFn(url, arg),
  );
}

// ─── URL Builder ───

export function buildApiUrl(path: string, params?: Record<string, string | number | boolean | undefined | null>): string {
  const base = env.BASE_API_URL.replace(/\/$/, '');
  const url = `${base}/${path.replace(/^\//, '')}`;

  if (!params) return url;

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  }

  const qs = searchParams.toString();
  return qs ? `${url}?${qs}` : url;
}
