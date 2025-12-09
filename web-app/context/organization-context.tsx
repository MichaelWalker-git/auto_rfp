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
  organization?: Organization;
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
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}

interface OrganizationProviderProps {
  children: ReactNode;
}

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const pathname = usePathname();

  // Parse IDs from URL once per render
  const orgMatch = pathname.match(/\/organizations\/([^/]+)/);
  const projectMatch = pathname.match(/\/projects\/([^/]+)/);

  const orgIdFromPath = orgMatch?.[1];
  const projectIdFromPath = projectMatch?.[1];

  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(
    projectIdFromPath,
  );

  const {
    data: organizations = [],
    mutate: mutateOrg,
    isLoading: isOrgLoading,
  } = useOrganizations();

  // Effective orgId for projects:
  // 1) currentOrganization.id
  // 2) orgId from URL
  const effectiveOrgId = currentOrganization?.id ?? orgIdFromPath ?? '';

  const {
    data: projects = [],
    mutate: mutateProjects,
    isLoading: isProjectsLoading,
  } = useProjects(effectiveOrgId);

  const {
    data: project,
    mutate: mutateProject,
    isLoading: isProjectLoading,
  } = useProject(projectId || '');

  const loading = isOrgLoading || isProjectsLoading || isProjectLoading;

  const refreshData = async () => {
    await mutateOrg();
    if (effectiveOrgId) {
      await mutateProjects();
    }
    if (projectId) {
      await mutateProject();
    }
  };

  // 1) Hydrate currentOrganization from URL or fallback to first org
  useEffect(() => {
    if (!organizations.length) return;

    // If we already have an org, do nothing
    if (currentOrganization) return;

    // Try by URL (id or slug)
    if (orgIdFromPath) {
      const found =
        organizations.find(
          (o) => o.id === orgIdFromPath || o.slug === orgIdFromPath,
        ) ?? null;
      if (found) {
        setCurrentOrganization(found);
        return;
      }
    }

    const pr = projects.find(p => p.id === projectId);
    const org = organizations.find((o) => o.id === pr?.orgId,) ?? null;
    setCurrentOrganization(org)
  }, [organizations, currentOrganization, orgIdFromPath]);

  // 2) Hydrate projectId from URL or from first project of current org
  useEffect(() => {
    if (!projects.length) return;

    // If URL has /projects/:id → honor it
    if (projectIdFromPath && projectId !== projectIdFromPath) {
      setProjectId(projectIdFromPath);
      return;
    }

    // No project in URL and none selected → auto-select first project
    if (!projectId && !pathname.includes('/projects/')) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId, projectIdFromPath, pathname]);

  // 3) If we have a loaded project but no organization, derive org from project
  useEffect(() => {
    if (!project) return;
    if (currentOrganization) return;

    if (project.organization) {
      setCurrentOrganization(project.organization);
      return;
    }

    if (organizations.length) {
      const found = organizations.find((o) => o.id === project.organizationId);
      if (found) {
        setCurrentOrganization(found);
      }
    }
  }, [project, currentOrganization, organizations]);

  const handleSetCurrentOrganization = (org: Organization | null) => {
    setCurrentOrganization(org);
    // Reset project when org changes – will be reselected via effect
    setProjectId(undefined);
  };

  const handleSetCurrentProject = (p: Project | null) => {
    setProjectId(p?.id);
    if (p?.organization) {
      setCurrentOrganization(p.organization);
    } else if (p?.organizationId && organizations.length) {
      const found = organizations.find((o) => o.id === p.organizationId);
      if (found) {
        setCurrentOrganization(found);
      }
    }
  };

  const value: OrganizationContextType = {
    currentOrganization,
    currentProject: (project as Project) ?? null,
    setCurrentOrganization: handleSetCurrentOrganization,
    setCurrentProject: handleSetCurrentProject,
    organizations,
    projects: (projects as unknown as Project[]) || [],
    loading,
    refreshData,
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}