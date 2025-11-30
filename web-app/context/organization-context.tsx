'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useOrganizations, useProject, useProjects } from '@/lib/hooks/use-api';

interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  organizationId: string;
  organization: Organization;
}

interface OrganizationContextType {
  currentOrganization: Organization | null;
  currentProject: Project | null;
  setCurrentOrganization: (org: Organization | null) => void;
  setCurrentProject: (project: Project | null) => void;
  organizations: Organization[];
  projects: Project[];
  loading: boolean;
  refreshData: () => Promise<void>;
}

const OrganizationContext =
  createContext<OrganizationContextType | undefined>(undefined);

export function useOrganization() {
  const context = useContext(OrganizationContext);

  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}

interface OrganizationProviderProps {
  children: ReactNode;
}

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const pathname = usePathname();
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>();
  const [initialLoad, setInitialLoad] = useState(true);

  const {
    data: organizations = [],
    mutate: mutateOrg,
    isLoading: isOrgLoading,
  } = useOrganizations();

  const {
    data: projects = [],
    mutate: mutateProjects,
    isLoading: isProjectsLoading,
  } = useProjects(currentOrganization?.id || '');

  const {
    data: project,
    mutate: mutateProject,
    isLoading: isProjectLoading,
  } = useProject(projectId || '');

  const loading = isOrgLoading || isProjectsLoading || isProjectLoading;

  const refreshData = async () => {
    await mutateOrg();
    if (currentOrganization) {
      await mutateProjects();
    }
    if (projectId) {
      await mutateProject();
    }
  };

  // Sync org & project from URL when pathname or data changes
  useEffect(() => {
    const orgMatch = pathname.match(/\/organizations\/([^/]+)/);
    const projectMatch = pathname.match(/\/projects\/([^/]+)/);

    const orgIdFromPath = orgMatch?.[1];
    const projectIdFromPath = projectMatch?.[1];

    // Set organization based on URL (match by id or slug)
    if (orgIdFromPath && organizations.length > 0) {
      const orgFromPath =
        organizations.find(
          (o) => o.id === orgIdFromPath || o.slug === orgIdFromPath,
        ) ?? null;

      setCurrentOrganization(orgFromPath);
    }

    // Set projectId from URL if present
    if (projectIdFromPath) {
      if (projectId !== projectIdFromPath) {
        setProjectId(projectIdFromPath);
      }
    } else {
      // No project in URL -> auto-select first project when ready & not on /projects/*
      const hasProjects = (projects?.length || 0) > 0;
      if (!pathname.includes('/projects/') && hasProjects && !initialLoad) {
        setProjectId(projects[0].id);
      }
    }

    if (initialLoad) {
      setInitialLoad(false);
    }
  }, [pathname, organizations, projects, projectId, initialLoad]);

  // When organization changes (e.g. user selects dropdown), refresh its projects
  useEffect(() => {
    if (currentOrganization && !initialLoad) {
      mutateProjects();
    }
  }, [currentOrganization, initialLoad, mutateProjects]);

  const handleSetCurrentOrganization = (org: Organization | null) => {
    setCurrentOrganization(org);
    // Clear project when org changes; will be re-selected via effect
    setProjectId(undefined);
  };

  const handleSetCurrentProject = (p: Project | null) => {
    setProjectId(p?.id);
    // Optionally keep org in sync with project’s org
    if (p?.organization) {
      setCurrentOrganization(p.organization);
    }
  };

  const value: OrganizationContextType = {
    currentOrganization,
    currentProject: project ?? null,
    setCurrentOrganization: handleSetCurrentOrganization,
    setCurrentProject: handleSetCurrentProject,
    organizations,
    projects: projects as any || [],
    loading,
    refreshData,
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}