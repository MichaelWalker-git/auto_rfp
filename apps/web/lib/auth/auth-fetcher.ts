'use client';
import { fetchAuthSession } from 'aws-amplify/auth';

export async function authFetcher(url: string, options: RequestInit = {}) {
  const session = await fetchAuthSession({ forceRefresh: false });
  const token = session.tokens?.idToken?.toString()
  return fetch(url, {
    ...options,
    headers: {
      ...(token ? { Authorization: token } : {}),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}