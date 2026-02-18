'use client';

import { useEffect } from 'react';
import { setOrganizationContext, setProjectContext, breadcrumbs } from '@/lib/sentry';

interface Organization {
  id: string;
  name?: string;
}

interface Project {
  id: string;
  name?: string;
  orgId?: string;
}

/**
 * Hook to set Sentry organization context when viewing an organization.
 * Automatically clears context when component unmounts.
 */
export function useSentryOrganization(org: Organization | null | undefined): void {
  useEffect(() => {
    if (org?.id) {
      setOrganizationContext({ id: org.id, name: org.name });
    }
    return () => {
      setOrganizationContext(null);
    };
  }, [org?.id, org?.name]);
}

/**
 * Hook to set Sentry project context when viewing a project.
 * Also adds a breadcrumb for project navigation.
 * Automatically clears context when component unmounts.
 */
export function useSentryProject(project: Project | null | undefined): void {
  useEffect(() => {
    if (project?.id) {
      setProjectContext({ id: project.id, name: project.name, orgId: project.orgId });
      breadcrumbs.projectViewed(project.id);
    }
    return () => {
      setProjectContext(null);
    };
  }, [project?.id, project?.name, project?.orgId]);
}

/**
 * Combined hook to set both organization and project context.
 * Useful for project pages that have both IDs available.
 */
export function useSentryNavigation(
  org: Organization | null | undefined,
  project: Project | null | undefined
): void {
  useSentryOrganization(org);
  useSentryProject(project);
}
