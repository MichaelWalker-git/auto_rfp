'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { fetchAuthSession } from 'aws-amplify/auth';
import * as Sentry from '@sentry/nextjs';
import '@/lib/amplify';
import '@aws-amplify/ui-react/styles.css';
import { JWT } from '@aws-amplify/core';
import { type Permission, ROLE_PERMISSIONS, type UserRole } from '@auto-rfp/core';

type AuthCtx = {
  isLoading: boolean;
  isAuthed: boolean;
  orgId: string | null;
  role: UserRole | null;
  permissions: Permission[];
  userSub: string | null;
  email: string | null;
  error: Error | null;
  getIdToken: () => Promise<JWT | null>;
  getAccessToken: () => Promise<JWT | null>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | null>(null);

let refreshPromise: Promise<void> | null = null;

function parseString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function AuthStateLoader({ onAuthChanged }: { onAuthChanged: () => void }) {
  const { user, route } = useAuthenticator((ctx) => [ctx.user, ctx.route]);
  const prev = useRef('');

  useEffect(() => {
    const key = user ? `user:${(user as any).userId}` : `route:${route}`;
    if (prev.current !== key) {
      prev.current = key;
      onAuthChanged();
    }
  }, [user, route, onAuthChanged]);

  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [userSub, setUserSub] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        // Clear all SWR cache on auth state change to prevent stale data from previous session
        // Use revalidate: true so data is refetched after clearing
        const { mutate: globalMutate } = await import('swr');
        await globalMutate(() => true, undefined, { revalidate: true });

        const session = await fetchAuthSession({ forceRefresh: true });
        const idToken = session.tokens?.idToken;

        if (!idToken) {
          setIsAuthed(false);
          setOrgId(null);
          setRole(null);
          setPermissions([]);
          setUserSub(null);
          setEmail(null);
          setError(null);
          Sentry.setUser(null);
          return;
        }

        const payload = idToken.payload as Record<string, unknown>;
        const nextRole = parseString(payload['custom:role']) as UserRole | null;

        const userSubValue = parseString(payload['sub']);
        const emailValue = parseString(payload['email']);
        const orgIdValue = parseString(payload['custom:orgId']);

        setIsAuthed(true);
        setOrgId(orgIdValue);
        setRole(nextRole);
        setPermissions(nextRole ? ROLE_PERMISSIONS[nextRole] ?? [] : []);
        setEmail(emailValue);
        setUserSub(userSubValue);
        setError(null);

        // Set Sentry user context for error tracking + feedback widget auto-fill
        const displayName = parseString(payload['name']) ||
          [parseString(payload['given_name']), parseString(payload['family_name'])].filter(Boolean).join(' ') ||
          emailValue?.split('@')[0] ||
          undefined;

        Sentry.setUser({
          id: userSubValue ?? undefined,
          email: emailValue ?? undefined,
          username: displayName ?? undefined,
        });
        Sentry.setTag('orgId', orgIdValue ?? 'none');
        Sentry.setTag('userRole', nextRole ?? 'none');
      } catch (e) {
        setIsAuthed(false);
        setError(e instanceof Error ? e : new Error('Auth failed'));
        Sentry.setUser(null);
      } finally {
        setIsLoading(false);
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }, []);

  const getIdToken = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken ?? null;
    } catch {
      return null;
    }
  }, []);

  const getAccessToken = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.accessToken ?? null;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      isLoading,
      isAuthed,
      orgId,
      role,
      permissions,
      userSub,
      email,
      error,
      getIdToken,
      getAccessToken,
      refresh,
    }),
    [isLoading, isAuthed, orgId, role, permissions, userSub, email, error, getIdToken, getAccessToken, refresh]
  );

  return (
    <Authenticator hideSignUp>
      <AuthContext.Provider value={value}>
        <AuthStateLoader onAuthChanged={refresh}/>
        {children}
      </AuthContext.Provider>
    </Authenticator>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}