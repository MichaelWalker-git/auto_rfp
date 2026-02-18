'use client';

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCurrentOrganization } from '@/context/organization-context';
import { useProjects } from '@/lib/hooks/use-api';
import { ProjectItem } from '@auto-rfp/core';

interface ProjectContextType {
  projects: ProjectItem[];
  currentProject: ProjectItem | null;
  loading: boolean;
  setCurrentProject: (p: ProjectItem | null) => void;
  refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider');
  return ctx;
}

function storageKey(orgId: string) {
  return `auto-rfp:currentProjectId:${orgId}`;
}

function safeGetLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string | null) {
  try {
    if (!value) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
  }
}

function extractProjectIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/\/organizations\/[^/]+\/projects\/([^/]+)(\/|$)/);
  return m?.[1] ?? null;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { currentOrganization } = useCurrentOrganization();

  const orgId = currentOrganization?.id ?? '';

  const { data: projects = [], mutate: mutateProjects, isLoading: isProjectsLoading } = useProjects(orgId);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      setSelectedProjectId(null);
      return;
    }

    const fromUrl = extractProjectIdFromPath(pathname);
    const fromStorage = safeGetLocalStorage(storageKey(orgId));

    const initial = fromUrl || fromStorage;
    setSelectedProjectId(initial);

    if (fromUrl && fromUrl !== fromStorage) {
      safeSetLocalStorage(storageKey(orgId), fromUrl);
    }
  }, [orgId, pathname]);

  useEffect(() => {
    if (!orgId) return;
    safeSetLocalStorage(storageKey(orgId), selectedProjectId);
  }, [orgId, selectedProjectId]);

  const currentProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!orgId) return;
    if (!selectedProjectId) return;
    if (!projects.length) return;

    const exists = projects.some((p) => p.id === selectedProjectId);
    if (!exists) {
      // Project was deleted or no longer accessible - redirect to projects list
      setSelectedProjectId(null);
      safeSetLocalStorage(storageKey(orgId), null);
      router.push(`/organizations/${orgId}/projects`);
    }
  }, [orgId, selectedProjectId, projects, router]);

  const setCurrentProject = (p: ProjectItem | null) => {
    const nextId = p?.id ?? null;
    setSelectedProjectId(nextId);
    safeSetLocalStorage(storageKey(orgId), nextId);

    if (nextId) router.push(`/organizations/${orgId}/projects/${nextId}/dashboard`);
  };

  const refreshProjects = async () => {
    await mutateProjects();
  };

  const value: ProjectContextType = {
    projects,
    currentProject,
    loading: isProjectsLoading,
    setCurrentProject,
    refreshProjects,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}