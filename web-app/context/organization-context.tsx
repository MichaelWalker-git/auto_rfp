'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useOrganizations, useMyOrganizations, setLastOrg } from '@/lib/hooks/use-api';
import { readStoredOrgId, writeStoredOrgId } from '@/lib/org-selection';
import { setOrganizationContext } from '@/lib/sentry';
import { mutate as globalMutate } from 'swr';

interface Organization {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  iconKey?: string;
}

interface OrganizationContextType {
  currentOrganization: Organization | null;
  organizations: Organization[];
  loading: boolean;
  refreshData: () => Promise<void>;
  setCurrentOrganization: (org: Organization | null) => void;
  isOrgLocked: boolean;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export function useCurrentOrganization() {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error('useCurrentOrganization must be used within an OrganizationProvider');
  return ctx;
}

export function isOnOrgRouteAndItIsNotCurrentOrg(pathname: string, currentOrgId: string) {
  const m = pathname.match(/^\/organizations\/([^/]+)(?:\/|$)/);
  if (!m) return false;
  const orgIdInPath = m[1];
  return orgIdInPath !== currentOrgId;
}


type Props = {
  children: ReactNode;
}

export function OrganizationProvider({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  // hydrate from localStorage
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() => readStoredOrgId());

  // Track whether we've done initial org selection
  const hasInitializedRef = useRef(false);

  // Admin users: fetch all orgs via get-organizations
  const {
    data: allOrganizations = [],
    mutate: mutateOrg,
    isLoading: isOrgLoading,
  } = useOrganizations();

  // All users: fetch orgs they belong to via get-my-organizations (multi-org support)
  const {
    data: myOrgsData,
    mutate: mutateMyOrgs,
    isLoading: isMyOrgsLoading,
  } = useMyOrganizations();

  const isLoading = isOrgLoading || isMyOrgsLoading;

  // Merge: prefer allOrganizations (works for admins), fall back to myOrgs for non-admin users
  const organizations = useMemo(() => {
    if (allOrganizations.length > 0) {
      return allOrganizations;
    }
    const myOrgs = myOrgsData?.organizations ?? [];
    if (myOrgs.length > 0) {
      return myOrgs.map((o) => ({
        id: o.orgId,
        name: o.orgName,
        slug: '',
        description: undefined,
        iconKey: undefined,
      }));
    }
    return [];
  }, [allOrganizations, myOrgsData]);

  // Only truly locked when orgs have loaded AND there's exactly 0 or 1
  const isOrgLocked = !isLoading && organizations.length <= 1;

  // On first load once orgs are available, resolve the initial org selection
  useEffect(() => {
    if (hasInitializedRef.current) return;
    if (isLoading) return;
    if (!organizations.length) return;

    hasInitializedRef.current = true;

    const localOrgId = readStoredOrgId();

    // If we have a valid local selection, use it
    if (localOrgId && organizations.some((o) => o.id === localOrgId)) {
      setSelectedOrgId(localOrgId);
      return;
    }

    // Try server-side lastOrgId
    const serverLastOrgId = myOrgsData?.lastOrgId;
    if (serverLastOrgId && organizations.some((o) => o.id === serverLastOrgId)) {
      setSelectedOrgId(serverLastOrgId);
      writeStoredOrgId(serverLastOrgId);
      return;
    }

    // Fallback: select first org
    const firstOrgId = organizations[0].id;
    setSelectedOrgId(firstOrgId);
    writeStoredOrgId(firstOrgId);
  }, [isLoading, organizations, myOrgsData?.lastOrgId]);

  // Keep selectedOrgId valid if organizations list changes after init
  useEffect(() => {
    if (!hasInitializedRef.current) return;
    if (!organizations.length) return;

    setSelectedOrgId((prev) => {
      if (prev && organizations.some((o) => o.id === prev)) return prev;
      const fallback = organizations[0].id;
      writeStoredOrgId(fallback);
      return fallback;
    });
  }, [organizations]);

  const currentOrganization = useMemo(() => {
    if (!organizations.length || !selectedOrgId) return null;
    return organizations.find((o: Organization) => o.id === selectedOrgId) ?? null;
  }, [organizations, selectedOrgId]);

  // Set Sentry context when organization changes
  useEffect(() => {
    if (currentOrganization) {
      setOrganizationContext({ id: currentOrganization.id, name: currentOrganization.name });
    } else {
      setOrganizationContext(null);
    }
  }, [currentOrganization]);

  // Redirect into org context if you're under a different org's route
  useEffect(() => {
    if (!currentOrganization?.id) return;
    if (isOnOrgRouteAndItIsNotCurrentOrg(pathname, currentOrganization.id)) {
      router.push(`/organizations/${currentOrganization.id}`);
    }
  }, [currentOrganization?.id, pathname, router]);

  const refreshData = async () => {
    await mutateOrg();
    await mutateMyOrgs();
  };

  const setCurrentOrganization = useCallback(
    (org: Organization | null) => {
      if (!org?.id) return;
      if (isOrgLocked) return;

      // Update state and localStorage immediately
      setSelectedOrgId(org.id);
      writeStoredOrgId(org.id);

      // Navigate to the new org
      router.push(`/organizations/${org.id}`);

      // Invalidate all SWR cache so data refetches with the new orgId
      globalMutate(() => true, undefined, { revalidate: true });

      // Persist last selected org to the server (fire-and-forget)
      setLastOrg(org.id).catch(() => {
        // Silently fail — this is a preference, not critical
      });
    },
    [isOrgLocked, router],
  );

  const value: OrganizationContextType = {
    currentOrganization,
    organizations,
    loading: isLoading,
    refreshData,
    setCurrentOrganization,
    isOrgLocked,
  };

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}
