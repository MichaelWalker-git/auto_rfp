'use client';

import useSWRMutation from 'swr/mutation';
import { useApi, apiMutate, buildApiUrl, ApiError } from './api-helpers';
import { ProjectKBLink, LinkKBToProjectRequest } from '@auto-rfp/core';

/**
 * GET all knowledge bases linked to a project.
 */
export function useProjectKBs(projectId: string | null, orgId?: string | null) {
  return useApi<ProjectKBLink[]>(
    projectId ? ['project-kbs', projectId, orgId] : null,
    projectId ? buildApiUrl('projects/get-project-kbs', { projectId, orgId: orgId || undefined }) : null,
  );
}

/**
 * Link a knowledge base to a project.
 */
export function useLinkKB() {
  return useSWRMutation<ProjectKBLink, ApiError, string, LinkKBToProjectRequest>(
    buildApiUrl('projects/link-kb'),
    async (url, { arg }) => apiMutate<ProjectKBLink>(url, 'POST', arg),
  );
}

/**
 * Unlink a knowledge base from a project.
 */
export function useUnlinkKB() {
  return useSWRMutation<unknown, ApiError, string, LinkKBToProjectRequest>(
    buildApiUrl('projects/unlink-kb'),
    async (url, { arg }) => apiMutate(url, 'DELETE', arg),
  );
}
