'use client';
import { fetchAuthSession } from 'aws-amplify/auth';

export async function authFetcher(url: string, options: RequestInit = {}) {
  let token: string | undefined;

  if (typeof window !== 'undefined') {
    const session = await fetchAuthSession();
    token = session.tokens?.idToken?.toString();
  }

  return fetch(url, {
    ...options,
    headers: {
      ...(token ? { Authorization: token } : {}),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}