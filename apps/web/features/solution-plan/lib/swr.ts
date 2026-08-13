import type { SWRConfiguration } from 'swr';
import type { ApiError } from '@/lib/hooks/api-helpers';

/**
 * Shared onErrorRetry for the solution-plan GET hooks: a 404 is the normal
 * "no plan yet" state and is never retried; anything else retries up to
 * 3 times with linear backoff.
 */
export const retryUnlessNotFound: NonNullable<SWRConfiguration['onErrorRetry']> = (
  err,
  _key,
  _config,
  revalidate,
  { retryCount },
) => {
  if ((err as ApiError).status === 404) return;
  if (retryCount >= 3) return;
  setTimeout(() => revalidate({ retryCount }), 2_000 * (retryCount + 1));
};
