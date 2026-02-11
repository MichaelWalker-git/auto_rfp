'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState, } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useOrganizations } from '@/lib/hooks/use-api';
import { useAuth } from '@/components/AuthProvider';
import { readStoredOrgId, writeStoredOrgId } from '@/lib/org-selection';
import { setOrganizationContext } from '@/lib/sentry';

interface Organization {
  id: string;
  name: string;
  slug: string;
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

  const { orgId: tokenOrgId } = useAuth();
  const isOrgLocked = !!tokenOrgId;

  // hydrate from localStorage (admin only)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() => readStoredOrgId());

  const {
    data: organizations = [],
    mutate: mutateOrg,
    isLoading: isOrgLoading,
  } = useOrganizations();

  // if user is locked → ignore stored/admin selection
  useEffect(() => {
    if (isOrgLocked) {
      setSelectedOrgId(null);
      writeStoredOrgId(null);
    }
  }, [isOrgLocked]);

  // ensure selectedOrgId is valid once organizations load (admin only)
  useEffect(() => {
    if (isOrgLocked) return;
    if (!organizations.length) return;

    setSelectedOrgId((prev) => {
      const candidate = prev ?? organizations[0].id;
      const exists = organizations.some((o: Organization) => o.id === candidate);
      return exists ? candidate : organizations[0].id;
    });
  }, [isOrgLocked, organizations]);

  // persist selection (admin only)
  useEffect(() => {
    if (isOrgLocked) return;
    writeStoredOrgId(selectedOrgId);
  }, [isOrgLocked, selectedOrgId]);

  const effectiveOrgId = useMemo(() => {
    if (tokenOrgId) return tokenOrgId;
    if (selectedOrgId) return selectedOrgId;
    return organizations[0]?.id ?? '';
  }, [tokenOrgId, selectedOrgId, organizations]);

  const currentOrganization = useMemo(() => {
    if (!organizations.length || !effectiveOrgId) return null;
    return organizations.find((o: Organization) => o.id === effectiveOrgId) ?? null;
  }, [organizations, effectiveOrgId]);

  // Set Sentry context when organization changes
  useEffect(() => {
    if (currentOrganization) {
      setOrganizationContext({ id: currentOrganization.id, name: currentOrganization.name });
    } else {
      setOrganizationContext(null);
    }
  }, [currentOrganization]);

  // redirect into org context if you're not already under /organizations/:id
  useEffect(() => {
    if (!currentOrganization?.id) return;
    if (isOnOrgRouteAndItIsNotCurrentOrg(pathname, currentOrganization.id)) {
      router.push(`/organizations/${currentOrganization.id}`);
    }
  }, [currentOrganization?.id, pathname, router]);

  const refreshData = async () => {
    await mutateOrg();
  };

  const setCurrentOrganization = useCallback(
    (org: Organization | null) => {
      if (tokenOrgId) return; // locked users cannot change
      setSelectedOrgId(org?.id ?? null);
      if (org?.id) router.push(`/organizations/${org.id}`);
    },
    [tokenOrgId, router],
  );

  const value: OrganizationContextType = {
    currentOrganization,
    organizations,
    loading: isOrgLoading,
    refreshData,
    setCurrentOrganization,
    isOrgLocked,
  };

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}